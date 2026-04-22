import { AbstractMessageWriter, Message, MessageWriter } from 'vscode-jsonrpc';


export class HttpClientMessageWriter extends AbstractMessageWriter implements MessageWriter {
  protected errorCount = 0;
  protected readonly baseUrl: string

  constructor(baseUrl: string) {
    super()
    if (!baseUrl.endsWith('/')) {
      baseUrl = baseUrl + '/';
    }
    this.baseUrl = baseUrl
  }
  end(): void {

  }

  async write(msg: Message): Promise<void> {
    try {
      const content = JSON.stringify(msg);
      const response = await fetch(new URL('rpc', this.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: content,
      });

      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      this.errorCount++;
      this.fireError(e, msg, this.errorCount);
    }
  }
  dispose(): void {
    // No resources to dispose
  }
}