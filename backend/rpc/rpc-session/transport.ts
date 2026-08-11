import type { Message } from "vscode-jsonrpc";

export interface SessionIOEnds {
  connectionWriterReader: ReadableStreamDefaultReader<Message>;
  connectionReaderWriter: WritableStreamDefaultWriter<Message>;
}

export interface TransportClient {
  on(
    event: "buildconnection",
    handler: (sessionId: string) => SessionIOEnds,
  ): void;
  on(
    event: "message",
    handler: (sessionId: string, message: Message) => void,
  ): void;
  on(event: "disconnect", handler: (sessionId: string) => void): void;

  listen(): Promise<void>;
  dispose(): void;
}

export interface TransportServer {
  on(event: "shakehand", handler: () => string): void;
  on(
    event: "buildconnection",
    handler: (sessionId: string) => SessionIOEnds,
  ): void;
  on(
    event: "message",
    handler: (sessionId: string, message: Message) => void,
  ): void;
  on(event: "disconnect", handler: (sessionId: string) => void): void;

  getApp(): unknown;
}
