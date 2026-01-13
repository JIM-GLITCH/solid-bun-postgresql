/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';

export default defineConfig({
  assetsInclude: ["**/*.html"],
  test: {
    server: {
      deps: {
        // external:["bun"]
      }
    },
    // include:["frontend/**/*.test.tsx"]
  },
  base: './',
  plugins: [devtools(), solidPlugin()],
  resolve: {
    conditions: ['development', 'browser'],
  },
});
