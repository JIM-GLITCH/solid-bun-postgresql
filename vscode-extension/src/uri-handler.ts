import * as vscode from "vscode";
import { TokenStorage } from "./token-storage";

export class DbPlayerUriHandler implements vscode.UriHandler {
  constructor(
    private readonly tokenStorage: TokenStorage,
    private readonly onTokenReceived?: () => void
  ) {}

  handleUri(uri: vscode.Uri): void {
    if (uri.path !== "/auth") return;
    const token = new URLSearchParams(uri.query).get("token");
    if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      vscode.window.showErrorMessage("DB Player: 无效的登录凭据，请重新登录");
      return;
    }
    this.tokenStorage.setToken(token).then(() => {
      vscode.window.showInformationMessage("DB Player: 登录成功");
      this.onTokenReceived?.();
    });
  }
}
