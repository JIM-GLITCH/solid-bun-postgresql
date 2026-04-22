import { RequestType } from 'vscode-jsonrpc';
import { EventSource } from 'eventsource';
import { createHttpClientMessageConnection } from '../';

type SumParams = { a: number; b: number };

const echoRequest = new RequestType<string, string, void>('demo/echo');
const sumRequest = new RequestType<SumParams, number, void>('demo/sum');

async function main() {
  const baseUrl = 'http://localhost:3000/xxx/';
  const connection = createHttpClientMessageConnection(baseUrl)


  connection.onRequest('ping', () => 'pong from client');
  connection.onError((error) => {
    console.error('[client] rpc error:', error);
  });
  connection.onClose(() => {
    console.log('[client] connection closed');
  });


  connection.listen();


  const result = await connection.sendRequest("ping")
  console.log(result)



  // const echoResult = await rpc.sendRequest(echoRequest, 'hello http json-rpc');
  // console.log('[client] echo result:', echoResult);

  // const sumResult = await rpc.sendRequest(sumRequest, { a: 7, b: 35 });
  // console.log('[client] sum result:', sumResult);

  // rpc.sendNotification('demo/ping', { from: 'client', at: new Date().toISOString() });

  // await new Promise((resolve) => setTimeout(resolve, 300));

  // const pingResult = await rpc.sendRequest('ping');
  // console.log('[client] ping result:', pingResult);
}

main().catch((error) => {
  console.error('[client] failed:', error);
  process.exitCode = 1;
});
