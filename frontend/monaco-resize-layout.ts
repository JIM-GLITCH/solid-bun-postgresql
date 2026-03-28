import type { editor } from "monaco-editor";

/**
 * Monaco 内置 automaticLayout 会在 ResizeObserver 内同步改 DOM，易触发 Chrome
 * 「ResizeObserver loop completed with undelivered notifications」。
 * 改为关闭 automaticLayout，在下一帧再 layout。
 */
export function attachMonacoLayoutOnResize(
  container: HTMLElement,
  ed: editor.IStandaloneCodeEditor
): () => void {
  let raf1 = 0;
  let raf2 = 0;
  const layout = () => {
    try {
      ed.layout();
    } catch {
      /* 已 dispose */
    }
  };
  const schedule = () => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(layout);
    });
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(container);
  schedule();
  return () => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    ro.disconnect();
  };
}

/** 内嵌 DiffEditor：与主编辑器相同，避免 automaticLayout 触发 ResizeObserver 循环告警 */
export function attachDiffEditorLayoutOnResize(
  container: HTMLElement,
  diffEd: editor.IStandaloneDiffEditor
): () => void {
  let raf1 = 0;
  let raf2 = 0;
  const layout = () => {
    try {
      diffEd.layout();
    } catch {
      /* 已 dispose */
    }
  };
  const schedule = () => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(layout);
    });
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(container);
  schedule();
  return () => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    ro.disconnect();
  };
}
