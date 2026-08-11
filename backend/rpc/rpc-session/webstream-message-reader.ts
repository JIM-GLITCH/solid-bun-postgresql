import { AbstractMessageReader, DataCallback, MessageReader, Disposable, Message } from "vscode-jsonrpc";

export class WebStreamMessageReader extends AbstractMessageReader implements MessageReader {
    protected callback: DataCallback | undefined;
    protected state: "initial" | "listening" | "closed" = "initial";
    protected readonly events: Array<{ message?: Message; error?: Error }> = [];
    public constructor(readable: ReadableStream<Message>) {
        super();
        const self = this
        readable.pipeTo(new WritableStream<Message>({
            abort(reason) {
                self.fireError(reason);
            },
            close() {
                self.fireClose()
            },
            write(chunk) {
                self.readMessage(chunk)
            }
        }))
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
        };
    }
    override dispose() {
        super.dispose();
        this.state = 'initial';
        this.callback = undefined;
        this.events.splice(0, this.events.length);
    }

    protected readMessage(message: Message): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, { message });
        } else if (this.state === 'listening') {
            try {
                this.callback!(message);
            } catch (err) {
                const error: Error = {
                    name: '' + 400,
                    message: `Error during message parsing, reason = ${typeof err === 'object' ? (err as any).message : 'unknown'}`
                };
                this.fireError(error);
            }
        }
    }

    protected override fireError(error: Error): void {
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
