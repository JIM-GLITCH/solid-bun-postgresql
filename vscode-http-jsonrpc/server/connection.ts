import { MessageReader, MessageWriter, Disposable, Message, createMessageConnection } from 'vscode-jsonrpc';
import { DisposableCollection } from '../disposable';
import { HttpServerMessageReader } from './reader';
import { Hono } from 'hono';
import { HttpServerMessageWriter } from './writer';


export interface IConnection extends Disposable {
    readonly reader: MessageReader;
    readonly writer: MessageWriter;
    forward(to: IConnection, map?: (message: Message) => Message): void;
    onClose(callback: () => void): Disposable;
}

export function createHttpServerMessageConnection() {
    const app = new Hono();
    const httpServerMessageReader = new HttpServerMessageReader(app)
    const httpServerMessageWriter = new HttpServerMessageWriter(app)
    const connection = createMessageConnection(httpServerMessageReader, httpServerMessageWriter)
    return {
        app,
        connection
    }
}


export function createConnection<T extends object>(reader: MessageReader, writer: MessageWriter, onDispose: () => void,
    extensions: T = {} as T): IConnection & T {
    const disposeOnClose = new DisposableCollection();
    reader.onClose(() => disposeOnClose.dispose());
    writer.onClose(() => disposeOnClose.dispose());
    return {
        reader,
        writer,
        forward(to: IConnection, map: (message: Message) => Message = (message) => message): void {
            reader.listen(input => {
                const output = map(input);
                to.writer.write(output);
            });
        },
        onClose(callback: () => void): Disposable {
            return disposeOnClose.push(Disposable.create(callback));
        },
        dispose: () => onDispose(),
        ...extensions
    };
}