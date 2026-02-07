/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';

export default defineConfig({
  assetsInclude: ["**/*.html"],
  test: {
    server: {
      deps: {}
    }
  },
  base: './',
  plugins: [devtools(), solidPlugin()],
  resolve: {
    conditions: ['development', 'browser'],
  },
});
