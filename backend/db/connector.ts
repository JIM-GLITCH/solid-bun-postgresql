import { getSqlSegments, type DbKind, type SSEMessage } from "../../shared/src";
import type { BorrowedClient, DbConnector, QueryResult, QuerySpec, StreamBatch, StreamPlan } from "./contract";
import type { SchemaContext } from "./schema-context";

export function splitStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

export async function withDeadRetry<T>(
  deps: {
    isDeadError: (e: unknown) => boolean;
    recreateUserClient: () => Promise<void>;
  },
  run: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt === 0 && deps.isDeadError(e)) {
        lastErr = e;
        await deps.recreateUserClient();
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export interface ConnectorStrategy {
  readonly dbKind: DbKind;

  query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>>;
  queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>>;
  queryWithDefaultSchema?<Row = any>(text: string, defaultSchema?: string): Promise<QueryResult<Row>>;

  withPoolClient<T>(fn: (client: BorrowedClient) => Promise<T>): Promise<T>;

  startStream(plan: StreamPlan, statements: string[], batchSize: number): Promise<StreamBatch>;
  readStreamBatch(opts: { batchSize: number; defaultSchema?: string }): Promise<StreamBatch>;
  endStream(): Promise<void>;

  cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }>;
  sessionThreadId?(): number | undefined;
  currentDatabase?(): string | undefined;
  sessionControl?(target: number, action: "cancel" | "terminate"): Promise<boolean>;

  buildSchemaContext(schema?: string): Promise<SchemaContext>;

  nativePool?(): unknown;
  setActiveRequest?(request: unknown): void;
  dispose?(): Promise<void>;
}

export interface ConnectorOptions {
  connectionId: string;
  dbKind: DbKind;
  capabilities: DbConnector["capabilities"];
  strategy: ConnectorStrategy;
}

export function createConnector(options: ConnectorOptions): DbConnector {
  const { connectionId, dbKind, capabilities, strategy } = options;

  const connector: DbConnector = {
    connectionId,
    dbKind,
    capabilities,

    query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      return strategy.query<Row>(spec, params);
    },

    queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      return strategy.queryAsUser<Row>(spec, params);
    },

    withPoolClient<T>(fn: (client: BorrowedClient) => Promise<T>): Promise<T> {
      return strategy.withPoolClient(fn);
    },

    async stream(plan: StreamPlan): Promise<StreamBatch> {
      const statements = plan.statements?.length ? plan.statements : splitStatements(plan.sql ?? "");
      if (statements.length === 0) return { rows: [], hasMore: false, columns: [] };
      await strategy.endStream();
      return strategy.startStream(plan, statements, Math.max(1, plan.batchSize));
    },

    streamMore(opts): Promise<StreamBatch> {
      return strategy.readStreamBatch({
        batchSize: Math.max(1, opts.batchSize),
        defaultSchema: opts.defaultSchema,
      });
    },

    teardownStream(): Promise<void> {
      return strategy.endStream();
    },

    async dispose(): Promise<void> {
      await strategy.endStream();
      await strategy.dispose?.();
    },

    cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }> {
      return strategy.cancelCurrentQuery();
    },

    sessionThreadId(): number | undefined {
      return strategy.sessionThreadId?.();
    },

    sessionInfo() {
      const currentDatabase = strategy.currentDatabase?.();
      return {
        connectionId,
        dbKind,
        ...(currentDatabase ? { currentDatabase } : {}),
      };
    },

    buildSchemaContext(schema?: string): Promise<SchemaContext> {
      return strategy.buildSchemaContext(schema);
    },

    watch(): AsyncIterable<SSEMessage> {
      return (async function* () {})();
    },
  };

  if (strategy.queryWithDefaultSchema) {
    connector.queryWithDefaultSchema = <Row = any>(text: string, defaultSchema?: string) =>
      strategy.queryWithDefaultSchema!<Row>(text, defaultSchema);
  }

  if (strategy.currentDatabase) {
    connector.currentDatabase = () => strategy.currentDatabase!();
  }

  if (strategy.sessionControl) {
    connector.sessionControl = (target, action) => strategy.sessionControl!(target, action);
  }

  if (strategy.nativePool) {
    connector.nativePool = () => strategy.nativePool!();
  }

  if (strategy.setActiveRequest) {
    connector.setActiveRequest = (request) => strategy.setActiveRequest!(request);
  }

  return connector;
}
