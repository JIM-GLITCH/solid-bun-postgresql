/**
 * 表格单元格格式化：兼容所有 PostgreSQL 类型
 *
 * 后端策略（connect-postgres.ts）：
 * - 日期时间：以字符串返回，避免 JS Date 丢失微秒精度
 * - 数组：由 node-pg 解析为 JS 数组，前端显示时转为 {a,b,c} 格式
 */

/** PostgreSQL 类型 OID（常见） */
export const PG_OID = {
  bool: 16,
  bytea: 17,
  char: 18,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  float4: 700,
  float8: 701,
  money: 790,
  json: 114,
  jsonb: 3802,
  date: 1082,
  time: 1083,
  timetz: 1266,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  numeric: 1700,
  uuid: 2950,
  inet: 869,
  cidr: 650,
  macaddr: 829,
  xml: 142,
  point: 600,
  box: 603,
  path: 602,
  polygon: 604,
  circle: 718,
  bit: 1560,
  varbit: 1562,
} as const;

import { PG_OID_TO_NAME } from "./pg-type-oids.js";

/** 判断是否为 PostgreSQL 数组类型 OID */
function isArrayTypeOid(dataTypeOid?: number): boolean {
  if (dataTypeOid == null) return false;
  const raw = PG_OID_TO_NAME[dataTypeOid];
  return !!raw && raw.startsWith("_");
}

/** 将 JS 数组转为 PostgreSQL 数组字面量格式 {a,b,c} */
function formatArrayToPgLiteral(arr: unknown[]): string {
  const parts = arr.map((el) => {
    if (el === null || el === undefined) return "NULL";
    if (Array.isArray(el)) return formatArrayToPgLiteral(el);
    if (typeof el === "boolean") return el ? "t" : "f";
    if (typeof el === "string") {
      const escaped = el.replace(/\\/g, "\\\\").replace(/"/g, '""');
      return `"${escaped}"`;
    }
    return String(el);
  });
  return "{" + parts.join(",") + "}";
}

export function getDataTypeName(dataTypeOid?: number): string {
  if (dataTypeOid == null) return "";
  const raw = PG_OID_TO_NAME[dataTypeOid] ?? `oid:${dataTypeOid}`;
  // 数组类型：_xxx → xxx[]，更符合 SQL 习惯（如 text[]、int4[]）
  if (raw.startsWith("_") && raw.length > 1) {
    return raw.slice(1) + "[]";
  }
  return raw;
}

/** 数字类型 OID */
const NUMERIC_OIDS = new Set([
  PG_OID.int2,
  PG_OID.int4,
  PG_OID.int8,
  PG_OID.float4,
  PG_OID.float8,
  PG_OID.numeric,
  PG_OID.money,
]);

/** 日期/时间类型 OID，需保持字符串以保留微秒精度 */
const DATE_TIME_OIDS = new Set([
  PG_OID.date,
  PG_OID.time,
  PG_OID.timetz,
  PG_OID.timestamp,
  PG_OID.timestamptz,
  PG_OID.interval,
]);

/** 右对齐类型 OID（数字、日期时间，参考 DBeaver 逻辑） */
const RIGHT_ALIGN_OIDS = new Set([
  ...NUMERIC_OIDS,
  ...DATE_TIME_OIDS,
]);

/** 根据列的类型 OID 返回对齐方式（左/右），不依赖单元格内容 */
export function getAlignmentFromDataType(dataTypeOid?: number): "left" | "right" {
  if (dataTypeOid == null) return "left";
  return RIGHT_ALIGN_OIDS.has(dataTypeOid as any) ? "right" : "left";
}

/** 格式化为表格显示 */
export function formatCellDisplay(value: unknown, dataTypeOid?: number): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "t" : "f";

  // Date 对象：可能是旧数据，转为 ISO 字符串（会丢失微秒，但至少能显示）
  if (value instanceof Date) return value.toISOString();

  // Buffer/bytea（含 JSON 序列化后的形态）
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "\\x" + value.toString("hex");
  if (typeof value === "object" && value !== null && "type" in value && (value as any).type === "Buffer" && Array.isArray((value as any).data)) {
    const hex = Array.from((value as any).data as number[])
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    return "\\x" + hex;
  }

  // PostgreSQL 数组类型：显示为 {a,b,c} 格式
  if (Array.isArray(value) && isArrayTypeOid(dataTypeOid)) {
    try {
      const str = formatArrayToPgLiteral(value);
      return str.length > 200 ? str.slice(0, 200) + "…" : str;
    } catch {
      return String(value);
    }
  }

  // JSON/JSONB：美化显示（截断过长内容）
  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value, null, 0);
      return str.length > 200 ? str.slice(0, 200) + "…" : str;
    } catch {
      return String(value);
    }
  }

  return String(value);
}

/** 转为可编辑的字符串（用于编辑框初始值，不截断） */
export function formatCellToEditable(value: unknown, dataTypeOid?: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "\\x" + value.toString("hex");
  if (typeof value === "object" && value !== null && "type" in value && (value as any).type === "Buffer" && Array.isArray((value as any).data)) {
    const hex = Array.from((value as any).data as number[]).map((b: number) => b.toString(16).padStart(2, "0")).join("");
    return "\\x" + hex;
  }
  if (Array.isArray(value) && isArrayTypeOid(dataTypeOid)) {
    try {
      return formatArrayToPgLiteral(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** 格式化为 SQL 字面量（用于 UPDATE 的 SET 子句） */
export function formatSqlValue(
  value: unknown,
  dataTypeOid?: number,
  dialect: "postgres" | "mysql" | "sqlserver" = "postgres"
): string {
  if (value === null || value === undefined) return "NULL";

  if (dialect === "mysql" || dialect === "sqlserver") {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "boolean") {
      if (dialect === "sqlserver") return value ? "1" : "0";
      return value ? "TRUE" : "FALSE";
    }
    if (typeof value === "string" && value.trim().toLowerCase() === "null") return "NULL";
    if (value instanceof Date) {
      const s = value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
      return `'${s.replace(/'/g, "''")}'`;
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return `X'${value.toString("hex")}'`;
    }
    if (typeof value === "object" && value !== null && "type" in value && (value as any).type === "Buffer" && Array.isArray((value as any).data)) {
      const hex = Array.from((value as any).data as number[])
        .map((b: number) => b.toString(16).padStart(2, "0"))
        .join("");
      return `X'${hex}'`;
    }
    if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "object") {
      try {
        return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
      } catch {
        return `'${String(value).replace(/'/g, "''")}'`;
      }
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  // JSONB/JSON 类型：字符串值直接作为 JSON 字面量处理，不走通用 null/bool 检测
  if (typeof value === "string" && dataTypeOid === PG_OID.jsonb) {
    return `'${value.replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof value === "string" && dataTypeOid === PG_OID.json) {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === "string" && value.trim().toLowerCase() === "null") return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  // 用户输入为字符串时，按列类型处理
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isNumeric = dataTypeOid !== undefined && NUMERIC_OIDS.has(dataTypeOid as any);
    if (isNumeric && trimmed !== "" && !Number.isNaN(Number(trimmed))) return trimmed;
    if (dataTypeOid === PG_OID.bool) {
      if (/^(t|true|yes|y|1)$/i.test(trimmed)) return "TRUE";
      if (/^(f|false|no|n|0)$/i.test(trimmed)) return "FALSE";
    }
  }

  // 日期时间：保持原字符串，确保微秒精度不丢失；按 OID 选择正确 cast
  const isDateTime = dataTypeOid !== undefined && DATE_TIME_OIDS.has(dataTypeOid as any);
  if (isDateTime || value instanceof Date) {
    const str = value instanceof Date ? value.toISOString() : String(value);
    const escaped = str.replace(/'/g, "''");
    const cast =
      dataTypeOid === PG_OID.date
        ? "::date"
        : dataTypeOid === PG_OID.time
          ? "::time"
          : dataTypeOid === PG_OID.timetz
            ? "::timetz"
            : dataTypeOid === PG_OID.timestamptz
              ? "::timestamptz"
              : dataTypeOid === PG_OID.interval
                ? "::interval"
                : "::timestamp";
    return `'${escaped}'${cast}`;
  }

  // 字符串
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `'\\x${value.toString("hex")}'::bytea`;
  }
  if (typeof value === "object" && value !== null && "type" in value && (value as any).type === "Buffer" && Array.isArray((value as any).data)) {
    const hex = Array.from((value as any).data as number[])
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    return `'\\x${hex}'::bytea`;
  }

  // JSON
  if (typeof value === "object") {
    try {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    } catch {
      return `'${String(value).replace(/'/g, "''")}'`;
    }
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}
