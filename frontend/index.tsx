import { render } from 'solid-js/web';
import App from './app';
import { loadDefaultTheme } from './theme-sync';

const root = document.getElementById('root');
if (root) {
  // initialize theme for standalone usage
  loadDefaultTheme();
  render(() => <App />, root);
}
