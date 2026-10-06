/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { singleFileCsp } from './build/singlefile-csp.ts';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), singleFileCsp()],
  build: {
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    reportCompressedSize: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
  },
});
