import type { Disposable as JsonRpcDisposable } from "vscode-jsonrpc";

export class DisposableCollection implements JsonRpcDisposable {
  protected readonly disposables: JsonRpcDisposable[] = [];

  dispose(): void {
    while (this.disposables.length !== 0) {
      this.disposables.pop()!.dispose();
    }
  }

  push(disposable: JsonRpcDisposable): JsonRpcDisposable {
    const disposables = this.disposables;
    disposables.push(disposable);
    return {
      dispose(): void {
        const index = disposables.indexOf(disposable);
        if (index !== -1) {
          disposables.splice(index, 1);
        }
      },
    };
  }
}

export const Disposable = {
  create(callback: () => void): JsonRpcDisposable {
    return { dispose: callback };
  },
};
