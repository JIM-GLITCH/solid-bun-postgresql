/**
 * 识别当前编辑器宿主：OAuth source 用 uriScheme；订阅站 ?host= 仅用 vscode.env.appName。
 */

import * as vscode from "vscode";

const EXTENSION_AUTH_AUTHORITY = "lilr.db-player";

export type DesktopOAuthContext = {
  /** 传给订阅站 ?source=，须与回跳 URL 协议一致（订阅 API 校验 source 与 scheme 匹配） */
  source: string;
  /** 传给 ?host=，仅来自 vscode.env.appName（空则回退「编辑器」） */
  displayName: string;
  uriScheme: string;
};

function cleanScheme(raw: string): string {
  const s = raw.trim().toLowerCase();
  return s || "vscode";
}

function displayNameFromApp(): string {
  const app = vscode.env.appName?.trim();
  return app || "编辑器";
}

/** OAuth 与订阅入口使用的宿主上下文（扩展侧单一真源） */
export function getDesktopOAuthContext(): DesktopOAuthContext {
  const uriScheme = cleanScheme(vscode.env.uriScheme ?? "vscode");
  return {
    source: uriScheme,
    displayName: displayNameFromApp(),
    uriScheme,
  };
}

/** 订阅站入口完整 URL（含 source、host） */
export function buildSubscriptionPortalEntryUrl(frontendRoot: string): string {
  const root = frontendRoot.trim().replace(/\/$/, "");
  const ctx = getDesktopOAuthContext();
  const href = /^https?:\/\//i.test(root) ? root : `https://${root}`;
  const u = new URL(href);
  u.searchParams.set("source", ctx.source);
  u.searchParams.set("host", ctx.displayName);
  return u.toString();
}

/** 深度链接回扩展 URI Handler：{scheme}://lilr.db-player/auth?token= */
export function getExtensionAuthCallbackUrl(scheme: string): string {
  return `${cleanScheme(scheme)}://${EXTENSION_AUTH_AUTHORITY}/auth`;
}
