import { MessageReader, AbstractMessageReader, DataCallback, Emitter } from 'vscode-jsonrpc';
import { Disposable } from 'vscode-jsonrpc';
import { EventSource } from 'eventsource';
import EventEmitter from 'events';

export class HttpClientMessageReader extends AbstractMessageReader implements MessageReader {

    private readonly eventSource: EventSource
    protected state: 'initial' | 'listening' | 'closed' = 'initial';
    protected callback: DataCallback | undefined;
    protected readonly events: Array<{ message?: any, error?: any }> = [];

    constructor(baseUrl: string) {
        super()
        if (!baseUrl.endsWith('/')) {
            baseUrl = baseUrl + '/';
        }
        this.eventSource = new EventSource(new URL('sse', baseUrl));

        this.eventSource.onmessage = (message) => {
            this.readMessage(message);
        };
        this.eventSource.onerror = (error) => {
            this.fireError(error);
        };
    }

    listen(callback: DataCallback): Disposable {
        if (this.state === 'initial') {
            this.state = 'listening';
            this.callback = callback;
            while (this.events.length !== 0) {
                const event = this.events.pop()!;
                if (event.message !== undefined) {
                    this.readMessage(event.message);
                } else if (event.error !== undefined) {
                    this.fireError(event.error);
                } else {
                    this.fireClose();
                }
            }
        }
        return {
            dispose: () => {
                if (this.callback === callback) {
                    this.state = 'initial';
                    this.callback = undefined;
                }
            }
        }

    }

    override dispose() {
        super.dispose();
        this.state = 'initial';
        this.callback = undefined;
        this.events.splice(0, this.events.length);
    }

    protected readMessage(message: MessageEvent | string): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, { message });
        } else if (this.state === 'listening') {
            try {
                const payload = typeof message === 'string' ? message : message.data;
                const data = JSON.parse(payload);
                this.callback!(data);
            } catch (err) {
                const error: Error = {
                    name: '' + 400,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    message: `Error during message parsing, reason = ${typeof err === 'object' ? (err as any).message : 'unknown'}`
                };
                this.fireError(error);
            }
        }
    }

    protected override fireError(error: any): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, { error });
        } else if (this.state === 'listening') {
            super.fireError(error);
        }
    }

    protected override fireClose(): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, {});
        } else if (this.state === 'listening') {
            super.fireClose();
        }
        this.state = 'closed';
    }
}