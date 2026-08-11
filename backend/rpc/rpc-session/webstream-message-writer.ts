import { AbstractMessageWriter, Message, MessageWriter } from 'vscode-jsonrpc';
export class WebStreamMessageWriter extends AbstractMessageWriter implements MessageWriter {
    protected errorCount = 0;
    protected readonly writable: WritableStream<Message>;
    protected readonly writer: WritableStreamDefaultWriter<Message>;
    constructor(writable: WritableStream<Message>) {
        super();
        this.writable = writable;
        this.writer = writable.getWriter();
    }

    end(): void { }

    async write(msg: Message): Promise<void> {
        try {
            const content = msg;

            this.writer.write(content);
        } catch (e) {
            this.errorCount++;
            this.fireError(e, msg, this.errorCount);
        }
    }
}
