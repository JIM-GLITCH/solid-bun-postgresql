import { render } from 'solid-js/web';
import App from './app';
import { DialogProvider } from './dialog-context';
import { loadDefaultTheme } from './theme-sync';
import { setTransport } from './transport';
import { HttpTransport } from './transport/http-transport';
import { getBrowserJwt } from './subscription/browser-token';

setTransport(
  new HttpTransport({
    getBearerToken: getBrowserJwt,
  })
);

function mount() {
  const root = document.getElementById('root');
  if (!root) {
    console.error('[frontend] #root not found');
    return;
  }
  loadDefaultTheme();
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}

// 确保 DOM 就绪后再挂载（script 可能在 head 中，此时 body 尚未解析）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
