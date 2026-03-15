/**
 * 查询结果导出：CSV / JSON / Excel
 *
 * - CSV / JSON：纯文本格式，跨平台、可版本管理、任何编辑器可打开。
 * - Excel (.xlsx)：文件格式本身是二进制（ZIP + XML），不是 npm 包的问题；
 *   生成 .xlsx 用的 xlsx (SheetJS) 是纯 JavaScript，无原生依赖，Node/Bun/浏览器通用。
 */

import { formatCellDisplay } from "../shared/src";
import type { ColumnEditableInfo } from "../shared/src";
import * as XLSX from "xlsx";

function escapeCsvCell(val: string): string {
  if (/[",\r\n]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** 导出为 CSV（UTF-8 BOM，Excel 可正确识别中文） */
export function exportAsCsv(
  columns: ColumnEditableInfo[],
  rows: any[][],
  filename = "export.csv"
): void {
  const headers = columns.map((c) => c.name);
  const lines: string[] = [headers.map(escapeCsvCell).join(",")];

  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const val = row[i];
      const dataTypeOid = col.dataTypeOid;
      const s = val !== null && val !== undefined ? formatCellDisplay(val, dataTypeOid) : "";
      return escapeCsvCell(s);
    });
    lines.push(cells.join(","));
  }

  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/** 导出为 JSON（数组 of 对象，键为列名） */
export function exportAsJson(
  columns: ColumnEditableInfo[],
  rows: any[][],
  filename = "export.json"
): void {
  const names = columns.map((c) => c.name);
  const arr = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    names.forEach((name, i) => {
      obj[name] = row[i] ?? null;
    });
    return obj;
  });
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

/** 导出为 Excel (.xlsx)。xlsx 为纯 JS 库，无原生依赖，跨平台。 */
export function exportAsExcel(
  columns: ColumnEditableInfo[],
  rows: any[][],
  filename = "export.xlsx"
): void {
  const headers = columns.map((c) => c.name);
  const data: (string | number | null)[][] = [headers];

  for (const row of rows) {
    const r = columns.map((col, i) => {
      const val = row[i];
      if (val === null || val === undefined) return null;
      const dataTypeOid = col.dataTypeOid;
      const s = formatCellDisplay(val, dataTypeOid);
      const num = Number(s);
      if (s !== "" && !Number.isNaN(num) && /^-?[\d.]+$/.test(s.trim())) return num;
      return s;
    });
    data.push(r);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
