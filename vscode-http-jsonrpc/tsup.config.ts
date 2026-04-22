import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: [
    'index.ts',
    'client/index.ts',
    'server/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2022',
  outDir: 'dist',
});
