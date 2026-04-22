import type { MessageConnection, Logger } from 'vscode-jsonrpc';
import { createMessageConnection } from 'vscode-jsonrpc';
import { HttpClientMessageReader } from './reader';
import { HttpClientMessageWriter } from './writer';

export function createHttpClientMessageConnection(baseUrl: string, logger?: Logger): MessageConnection {
    const messageReader = new HttpClientMessageReader(baseUrl);
    const messageWriter = new HttpClientMessageWriter(baseUrl);
    const connection = createMessageConnection(messageReader, messageWriter, logger);
    connection.onClose(() => connection.dispose());
    return connection;
}