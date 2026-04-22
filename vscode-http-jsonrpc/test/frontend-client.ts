import { RequestType } from 'vscode-jsonrpc';
import { createHttpClientMessageConnection } from '../client/connection';

type SumParams = { a: number; b: number };

const echoRequest = new RequestType<string, string, void>('demo/echo');
const sumRequest = new RequestType<SumParams, number, void>('demo/sum');
const baseUrl = `http://localhost:3000/xxx/`;
const rpc = createHttpClientMessageConnection(baseUrl);

const logEl = document.getElementById('log') as HTMLPreElement;
const echoInput = document.getElementById('echoInput') as HTMLInputElement;
const aInput = document.getElementById('aInput') as HTMLInputElement;
const bInput = document.getElementById('bInput') as HTMLInputElement;
const echoBtn = document.getElementById('echoBtn') as HTMLButtonElement;
const sumBtn = document.getElementById('sumBtn') as HTMLButtonElement;
const pingBtn = document.getElementById('pingBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

function log(...args: unknown[]) {
  const line = args
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
    .join(' ');
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

rpc.onError((error) => {
  log('[client][error]', error);
});
rpc.onClose(() => {
  log('[client] connection closed');
});
rpc.listen();
log('[client] connected to', baseUrl);

echoBtn.onclick = async () => {
  try {
    const result = await rpc.sendRequest(echoRequest, echoInput.value);
    log('[result] demo/echo =', result);
  } catch (error) {
    log('[error] demo/echo', error);
  }
};

sumBtn.onclick = async () => {
  try {
    const result = await rpc.sendRequest(sumRequest, {
      a: Number(aInput.value),
      b: Number(bInput.value),
    });
    log('[result] demo/sum =', result);
  } catch (error) {
    log('[error] demo/sum', error);
  }
};

pingBtn.onclick = () => {
  rpc.sendNotification('demo/ping', {
    from: 'browser-client',
    at: new Date().toISOString(),
  });
  log('[result] demo/ping sent');
};

clearBtn.onclick = () => {
  logEl.textContent = '';
};
