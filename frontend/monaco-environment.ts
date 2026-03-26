/**
 * Monaco Worker 配置。
 * VS Code Webview 文档源为 vscode-webview://，而 worker 脚本 URI 为 vscode-resource / file+ CDN，
 * 浏览器禁止跨源 `new Worker(scriptUrl)`。解决办法：`fetch` 脚本文本后 `blob:` + `Worker(blobUrl)`（与页面同源）。
 * 参见 extension CSP：`worker-src ... blob:`。
 */
const MONACO_BASE =
  (typeof window !== "undefined" && (window as unknown as { __MONACO_BASE__?: string }).__MONACO_BASE__) ||
  "./vs";

function workerScriptUrl(_moduleId: string, label: string): string {
  if (label === "json") return `${MONACO_BASE}/assets/json.worker-DKiEKt88.js`;
  if (label === "css" || label === "scss" || label === "less")
    return `${MONACO_BASE}/assets/css.worker-HnVq6Ewq.js`;
  if (label === "html" || label === "handlebars" || label === "razor")
    return `${MONACO_BASE}/assets/html.worker-B51mlPHg.js`;
  if (label === "typescript" || label === "javascript")
    return `${MONACO_BASE}/assets/ts.worker-CMbG-7ft.js`;
  return `${MONACO_BASE}/assets/editor.worker-Be8ye1pW.js`;
}

function isVscodeWebview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.location.protocol === "vscode-webview:";
  } catch {
    return false;
  }
}

const blobUrlByScript = new Map<string, string>();

async function createWorkerViaBlob(scriptUrl: string, name: string): Promise<Worker> {
  let blobUrl = blobUrlByScript.get(scriptUrl);
  if (!blobUrl) {
    const res = await fetch(scriptUrl);
    if (!res.ok) throw new Error(`Monaco worker fetch failed ${res.status}: ${scriptUrl}`);
    const code = await res.text();
    const blob = new Blob([code], { type: "application/javascript" });
    blobUrl = URL.createObjectURL(blob);
    blobUrlByScript.set(scriptUrl, blobUrl);
  }
  return new Worker(blobUrl, { name, type: "classic" });
}

type MonacoEnv = {
  getWorkerUrl?: (moduleId: string, label: string) => string;
  getWorker?: (workerId: string, label: string) => Worker | Promise<Worker>;
};

if (typeof self !== "undefined") {
  const w = self as unknown as { MonacoEnvironment?: MonacoEnv };
  if (!w.MonacoEnvironment) {
    if (isVscodeWebview()) {
      w.MonacoEnvironment = {
        getWorker: (workerId, label) => createWorkerViaBlob(workerScriptUrl(workerId, label), label),
      };
    } else {
      w.MonacoEnvironment = {
        getWorkerUrl: (_: string, label: string) => workerScriptUrl(_, label),
      };
    }
  }
}
