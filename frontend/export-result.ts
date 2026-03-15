/**
 * 查询结果导出：CSV / JSON / Excel
 *
 * - CSV / JSON：纯文本格式，跨平台、可版本管理、任何编辑器可打开。
 * - Excel (.xlsx)：文件格式本身是二进制（ZIP + XML），不是 npm 包的问题；
 *   生成 .xlsx 用的 xlsx (SheetJS) 是纯 JavaScript，无原生依赖，Node/Bun/浏览器通用。
 * - VSCode 插件内：优先用扩展「另存为」弹窗写盘，失败或非插件环境则回退到浏览器下载。
 */

import { formatCellDisplay } from "../shared/src";
import type { ColumnEditableInfo } from "../shared/src";
import * as XLSX from "xlsx";
import { saveFileViaVscode } from "./api";

function escapeCsvCell(val: string): string {
  if (/[",\r\n]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function saveOrDownload(content: string | Blob, filename: string, options?: { isBase64?: boolean }): Promise<void> {
  try {
    const saved = await saveFileViaVscode(
      typeof content === "string" ? content : await blobToBase64(content),
      filename,
      options ?? (typeof content !== "string" ? { isBase64: true } : undefined)
    );
    if (saved) return;
  } catch {
    // 非 VSCode 或用户取消等，回退到浏览器下载
  }
  const blob = typeof content === "string" ? new Blob([content], { type: "text/plain;charset=utf-8" }) : content;
  downloadBlob(blob, filename);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const bytes = new Uint8Array(r.result as ArrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      resolve(typeof btoa !== "undefined" ? btoa(binary) : "");
    };
    r.onerror = () => reject(new Error("Blob read failed"));
    r.readAsArrayBuffer(blob);
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const text = bom + lines.join("\r\n");
  saveOrDownload(text, filename).catch(() => downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), filename));
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
  const text = JSON.stringify(arr, null, 2);
  saveOrDownload(text, filename).catch(() => downloadBlob(new Blob([text], { type: "application/json" }), filename));
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
  const array = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as number[];
  const blob = new Blob([new Uint8Array(array)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  blobToBase64(blob).then((base64) => saveOrDownload(base64, filename, { isBase64: true })).catch(() => downloadBlob(blob, filename));
}
