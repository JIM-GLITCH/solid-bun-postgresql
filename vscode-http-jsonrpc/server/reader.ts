import { Hono } from 'hono';
import { MessageReader, AbstractMessageReader, DataCallback } from 'vscode-jsonrpc';
import { Disposable } from 'vscode-jsonrpc';

export interface HttpServerMessageReaderOptions {
    /**
     * 首次进入 listen 时触发。可在这里启动 Hono / Node HTTP 服务。
     */
    onListen?: () => void;
}

export class HttpServerMessageReader extends AbstractMessageReader implements MessageReader {

    private readonly app: Hono
    protected state: 'initial' | 'listening' | 'closed' = 'initial';
    protected callback: DataCallback | undefined;
    protected readonly events: Array<{ message?: unknown, error?: unknown, close?: true }> = [];

    constructor(app: Hono) {
        super();
        this.app = app
            .post("/rpc", async (c) => {
                const message = await c.req.json();
                this.readMessage(message);
                return c.json({ ok: true });
            })
            .onError((err, c) => {
                this.fireError(err);
                return c.text('Internal server error', 500);
            });
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

    override dispose(): void {
        super.dispose();
        this.state = 'closed';
        this.callback = undefined;
        this.events.length = 0;
    }

    protected readMessage(message: unknown): void {
        if (this.state === 'initial') {
            this.events.push({ message });
            return;
        }
        if (this.state !== 'listening' || this.callback === undefined) {
            return;
        }
        try {
            const parsed = typeof message === 'string' ? JSON.parse(message) : message;
            this.callback(parsed);
        } catch (err) {
            const error = new Error(
                `Error during message parsing, reason = ${err instanceof Error ? err.message : 'unknown'}`
            );
            this.fireError(error);
        }
    }

    protected override fireError(error: unknown): void {
        if (this.state === 'initial') {
            this.events.push({ error });
            return;
        }
        if (this.state === 'listening') {
            super.fireError(error);
        }
    }

    protected override fireClose(): void {
        if (this.state === 'initial') {
            this.events.push({ close: true });
            return;
        }
        if (this.state === 'listening') {
            super.fireClose();
        }
        this.state = 'closed';
        this.callback = undefined;
    }
}