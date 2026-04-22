import * as net from 'node:net';
import * as stream from 'node:stream';
import * as cp from 'node:child_process';
import { StreamMessageReader, StreamMessageWriter, SocketMessageReader, SocketMessageWriter } from 'vscode-jsonrpc/node.js';
import { type IConnection, createConnection } from './connection.js';
export function createServerProcess(serverName: string, command: string, args?: string[], options?: cp.SpawnOptions): IConnection | undefined {
    const serverProcess = cp.spawn(command, args || [], options || {});
    serverProcess.on('error', error =>
        console.error(`Launching ${serverName} Server failed: ${error}`)
    );
    if (serverProcess.stderr !== null) {
        serverProcess.stderr.on('data', data =>
            console.error(`${serverName} Server: ${data}`)
        );
    }
    return createProcessStreamConnection(serverProcess);
}


export function createProcessStreamConnection(process: cp.ChildProcess): IConnection | undefined {
    if (process.stdout !== null && process.stdin !== null) {
        return createStreamConnection(process.stdout, process.stdin, () => process.kill());
    } else {
        return undefined;
    }
}

export function createStreamConnection(outStream: stream.Readable, inStream: stream.Writable, onDispose: () => void): IConnection {
    const reader = new StreamMessageReader(outStream);
    const writer = new StreamMessageWriter(inStream);
    return createConnection(reader, writer, onDispose);
}