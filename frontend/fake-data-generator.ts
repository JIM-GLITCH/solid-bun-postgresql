/**
 * 假数据生成器 - 根据表结构生成测试数据
 * 支持：姓名、日期、数字、UUID、文本等
 */

export interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default?: string | null;
  character_maximum_length?: number | null;
  /** MySQL: information_schema.COLUMNS.EXTRA；PostgreSQL: identity_generation */
  identity_generation?: string | null;
}

/** MySQL 计算列 / 生成列：不应出现在 INSERT 列清单中 */
export function isGeneratedStoredColumn(col: TableColumn): boolean {
  const ex = String(col.identity_generation ?? "").toLowerCase();
  return (
    (ex.includes("virtual") && ex.includes("generated")) ||
    (ex.includes("stored") && ex.includes("generated"))
  );
}

function isMysqlAutoIncrementExtra(extra: string | null | undefined): boolean {
  return String(extra ?? "").toLowerCase().includes("auto_increment");
}

/** MySQL DATETIME / TIMESTAMP 常用字面量（避免仅依赖带 Z 的 ISO 串） */
function formatMySqlDateTime(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/** 需要保证唯一性的列名集合（主键 + 唯一约束） */
export type UniqueColumnsSet = Set<string>;

/** 根据列名推断生成器类型（不区分大小写） */
function inferGeneratorFromColumnName(columnName: string): string | null {
  const lower = columnName.toLowerCase();
  if (lower.includes("name") && !lower.includes("username") && !lower.includes("filename")) return "name";
  if (lower.includes("email") || lower.includes("mail")) return "email";
  if (lower.includes("phone") || lower.includes("tel") || lower.includes("mobile")) return "phone";
  if (lower.includes("address") || lower.includes("addr")) return "address";
  if (lower.includes("url") || lower.includes("link")) return "url";
  if (lower.includes("title")) return "title";
  if (lower.includes("description") || lower.includes("desc") || lower.includes("content")) return "description";
  if (lower.includes("username") || lower.includes("login")) return "username";
  if (lower.includes("password") || lower.includes("pwd")) return "password";
  if (lower.includes("code") && !lower.includes("postcode")) return "code";
  if (lower.includes("price") || lower.includes("amount") || lower.includes("money") || lower.includes("salary")) return "money";
  if (lower.includes("age")) return "age";
  if (lower.includes("status")) return "status";
  if (lower.includes("type") && lower.length <= 10) return "type";
  if (lower.includes("gender") || lower.includes("sex")) return "gender";
  if (lower.includes("country") || lower.includes("nation")) return "country";
  if (lower.includes("city")) return "city";
  if (lower.includes("postcode") || lower.includes("zip")) return "postcode";
  return null;
}

const CHINESE_SURNAMES = ["张", "王", "李", "赵", "刘", "陈", "杨", "黄", "周", "吴", "徐", "孙", "胡", "朱", "高", "林", "何", "郭", "马", "罗"];
const CHINESE_NAMES = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "洋", "勇", "军", "杰", "娟", "艳", "涛", "明", "超", "秀", "霞", "平"];
const STATUS_WORDS = ["待处理", "进行中", "已完成", "已取消", "草稿"];
const TYPE_WORDS = ["类型A", "类型B", "类型C", "普通", "高级", "VIP"];
const DOMAINS = ["example.com", "test.com", "demo.org", "sample.net"];
const CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "南京", "苏州"];
const COUNTRIES = ["中国", "美国", "日本", "德国", "英国", "法国", "韩国", "澳大利亚"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateByInferredType(inferred: string, maxLen?: number, rowIndex?: number, requireUnique?: boolean): string {
  const useUnique = requireUnique && rowIndex != null;
  switch (inferred) {
    case "name":
      return randomChoice(CHINESE_SURNAMES) + randomChoice(CHINESE_NAMES) + (useUnique ? `_${rowIndex}` : (Math.random() > 0.5 ? randomChoice(CHINESE_NAMES) : ""));
    case "email":
      return useUnique ? `user${rowIndex}@${randomChoice(DOMAINS)}` : `user${randomInt(1, 9999)}@${randomChoice(DOMAINS)}`;
    case "phone":
      return useUnique ? `1${String(3 + (rowIndex % 7))}${String(rowIndex).padStart(9, "0").slice(-9)}` : `1${randomInt(3, 9)}${String(randomInt(0, 999999999)).padStart(9, "0")}`;
    case "address":
      return `${randomChoice(CITIES)}市${randomChoice(["朝阳", "海淀", "浦东", "天河"])}区${useUnique ? rowIndex : randomInt(1, 999)}号`;
    case "url":
      return useUnique ? `https://${randomChoice(DOMAINS)}/path/${rowIndex}` : `https://${randomChoice(DOMAINS)}/path/${randomInt(1, 999)}`;
    case "title":
      return useUnique ? `标题${rowIndex}` : `标题${randomInt(1, 9999)}`;
    case "description":
      return `描述内容 ${useUnique ? rowIndex : randomInt(1, 999)}`;
    case "username":
      return useUnique ? `user_${rowIndex}` : `user_${randomInt(1000, 99999)}`;
    case "password":
      return `pwd_${randomInt(100000, 999999)}`;
    case "code":
      return useUnique ? `CODE${rowIndex}` : `CODE${randomInt(100, 9999)}`;
    case "status":
      return randomChoice(STATUS_WORDS);
    case "type":
      return randomChoice(TYPE_WORDS);
    case "gender":
      return randomChoice(["男", "女", "未知"]);
    case "country":
      return randomChoice(COUNTRIES);
    case "city":
      return randomChoice(CITIES);
    case "postcode":
      return useUnique ? String(100000 + (rowIndex % 900000)) : String(randomInt(100000, 999999));
    case "money":
      return (Math.random() * 9999.99 + 0.01).toFixed(2);
    case "age":
      return String(randomInt(18, 80));
    default:
      return useUnique ? `value_${rowIndex}` : `value_${randomInt(1, 9999)}`;
  }
}

function truncate(str: string, maxLen?: number): string {
  if (maxLen == null || maxLen <= 0) return str;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

/** 为单列生成一个假数据值 */
export function generateValueForColumn(
  col: TableColumn,
  rowIndex: number,
  options?: { uniqueColumns?: UniqueColumnsSet }
): unknown {
  const inferred = inferGeneratorFromColumnName(col.column_name);
  const dataType = (col.data_type || "").toLowerCase();
  const maxLen = col.character_maximum_length ?? undefined;
  const nullable = col.is_nullable === "YES";
  const requireUnique = options?.uniqueColumns?.has(col.column_name) ?? false;

  // 唯一约束列不生成 null
  if (nullable && !requireUnique && Math.random() < 0.05) return null;

  // MySQL AUTO_INCREMENT：插入 NULL 由引擎分配，避免与已有主键冲突
  if (isMysqlAutoIncrementExtra(col.identity_generation)) {
    return null;
  }

  // 有 default 且是 nextval/序列的（serial 等），通常由数据库自动生成，可跳过或生成递增值
  const def = (col.column_default || "").toLowerCase();
  if (def.includes("nextval") || def.includes("gen_random_uuid")) {
    if (dataType.includes("serial") || dataType.includes("int")) return rowIndex + 1;
    if (dataType.includes("uuid")) return randomUUID();
  }

  // 主键/唯一约束的整数列：使用 rowIndex 保证唯一
  if (requireUnique && (dataType.includes("int") || dataType === "smallint" || dataType === "bigint")) {
    return rowIndex + 1;
  }

  // 按推断类型生成
  if (inferred) {
    const val = generateByInferredType(inferred, maxLen, rowIndex, requireUnique);
    return truncate(val, maxLen);
  }

  // 按数据类型生成
  if (dataType.includes("int") || dataType === "smallint" || dataType === "bigint" || dataType === "serial" || dataType === "bigserial" || dataType === "smallserial") {
    return requireUnique ? rowIndex + 1 : randomInt(1, 999999);
  }
  if (
    dataType === "real" ||
    dataType === "double precision" ||
    dataType === "float4" ||
    dataType === "float8" ||
    dataType === "double" ||
    dataType === "float"
  ) {
    return Math.round((Math.random() * 9999.99 + 0.01) * 100) / 100;
  }
  if (dataType === "numeric" || dataType === "decimal") {
    return Math.round((Math.random() * 9999.99 + 0.01) * 100) / 100;
  }
  if (dataType === "boolean" || dataType === "bool") {
    return Math.random() > 0.5;
  }
  if (dataType === "year") {
    return 2000 + (requireUnique ? rowIndex % 25 : randomInt(0, 24));
  }
  if (dataType === "time") {
    const base = requireUnique ? rowIndex * 37 : randomInt(0, 86400 - 1);
    const h = Math.floor(base / 3600) % 24;
    const m = Math.floor(base / 60) % 60;
    const s = base % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (dataType === "datetime") {
    const d = new Date(Date.UTC(2020, 0, 1));
    d.setUTCMinutes(d.getUTCMinutes() + (requireUnique ? rowIndex : randomInt(0, 1825 * 24 * 60)));
    return formatMySqlDateTime(d);
  }
  if (dataType === "date") {
    const d = new Date(2020, 0, 1);
    d.setDate(d.getDate() + (requireUnique ? rowIndex % 1825 : randomInt(0, 1825)));
    return d.toISOString().slice(0, 10);
  }
  if (dataType.includes("timestamp") || dataType.includes("timestamptz")) {
    const d = new Date(2020, 0, 1);
    d.setTime(d.getTime() + (requireUnique ? rowIndex * 60000 : randomInt(0, 1825 * 24 * 60 * 60 * 1000)));
    return d.toISOString();
  }
  if (dataType === "uuid") {
    return randomUUID();
  }
  if (dataType === "jsonb" || dataType === "json") {
    return JSON.stringify({ id: requireUnique ? rowIndex : randomInt(1, 999), name: `item_${requireUnique ? rowIndex : randomInt(1, 99)}` });
  }
  if (dataType === "bit") {
    return Math.random() > 0.5 ? 1 : 0;
  }
  if (
    dataType === "binary" ||
    dataType === "varbinary" ||
    dataType === "blob" ||
    dataType === "tinyblob" ||
    dataType === "mediumblob" ||
    dataType === "longblob"
  ) {
    const raw = requireUnique ? `blob_${rowIndex}_testdata` : `blob_${randomInt(1, 9999)}_x`;
    return truncate(raw, maxLen ?? 255);
  }
  if (dataType.includes("char") || dataType === "character varying" || dataType === "text") {
    const val = requireUnique ? `文本_${rowIndex}` : `文本_${randomInt(1, 9999)}`;
    return truncate(val, maxLen);
  }
  if (dataType === "tinytext" || dataType === "mediumtext" || dataType === "longtext") {
    const val = requireUnique ? `长文本_${rowIndex}` : `长文本_${randomInt(1, 9999)}`;
    return truncate(val, maxLen);
  }

  // 默认：短文本
  return truncate(requireUnique ? `val_${rowIndex}` : `val_${randomInt(1, 9999)}`, maxLen);
}

/** 为多列生成一行数据 */
export function generateRow(
  columns: TableColumn[],
  rowIndex: number,
  options?: { uniqueColumns?: UniqueColumnsSet }
): unknown[] {
  return columns.map((col) => generateValueForColumn(col, rowIndex, options));
}

/** 生成多行假数据 */
export function generateFakeData(
  columns: TableColumn[],
  rowCount: number,
  options?: { uniqueColumns?: UniqueColumnsSet }
): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(generateRow(columns, i, options));
  }
  return rows;
}
