/**
 * 解析 CSV / JSON / Excel 文件为 { headers, rows }
 */

import * as XLSX from "xlsx";

export interface ParsedImport {
  headers: string[];
  rows: any[][];
  error?: string;
}

/** 解析 CSV 文本：首行为表头，支持双引号包裹含逗号/换行的字段 */
export function parseCsv(text: string): ParsedImport {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      cell += c;
    } else if (c === "," || c === "\t") {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell.trim());
  rows.push(row);

  if (rows.length === 0) return { headers: [], rows: [], error: "文件为空" };
  const headers = rows[0];
  const dataRows = rows.slice(1).map((r) => {
    const arr: any[] = [];
    for (let i = 0; i < headers.length; i++) {
      const v = r[i] ?? "";
      if (v === "" || v.toLowerCase() === "null") arr.push(null);
      else arr.push(v);
    }
    return arr;
  });
  return { headers, rows: dataRows };
}

/** 解析 JSON：支持 [ { "col1": v1, "col2": v2 }, ... ] */
export function parseJson(text: string): ParsedImport {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data) || data.length === 0) {
      return { headers: [], rows: [], error: "JSON 需为非空数组" };
    }
    const first = data[0];
    if (typeof first !== "object" || first === null) {
      return { headers: [], rows: [], error: "数组元素需为对象" };
    }
    const headers = Object.keys(first);
    const rows = data.map((obj: any) => headers.map((h) => (obj[h] ?? null)));
    return { headers, rows };
  } catch (e) {
    return { headers: [], rows: [], error: (e as Error).message };
  }
}

/** 解析 Excel (.xlsx/.xls)：取第一个工作表，首行为表头 */
export function parseXlsx(buffer: ArrayBuffer): ParsedImport {
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return { headers: [], rows: [], error: "工作簿为空" };
    const ws = wb.Sheets[firstSheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
    if (!aoa.length) return { headers: [], rows: [], error: "工作表为空" };
    const headers = aoa[0].map((c) => (c != null ? String(c) : ""));
    const rows = aoa.slice(1).map((row) => {
      return headers.map((_, i) => {
        const v = row[i];
        if (v === undefined || v === null || v === "") return null;
        return v;
      });
    });
    return { headers, rows };
  } catch (e) {
    return { headers: [], rows: [], error: (e as Error).message };
  }
}

export function parseImportFile(file: File): Promise<ParsedImport> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result;
        if (buffer instanceof ArrayBuffer) {
          resolve(parseXlsx(buffer));
        } else {
          resolve({ headers: [], rows: [], error: "读取文件失败" });
        }
      };
      reader.onerror = () => resolve({ headers: [], rows: [], error: "读取文件失败" });
      reader.readAsArrayBuffer(file);
    });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (name.endsWith(".json")) {
        resolve(parseJson(text));
      } else {
        resolve(parseCsv(text));
      }
    };
    reader.onerror = () => resolve({ headers: [], rows: [], error: "读取文件失败" });
    reader.readAsText(file, "UTF-8");
  });
}
