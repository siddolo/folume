import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { strings } from './src/shared/strings';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export default defineConfig({
  plugins: [react(), {
    name: 'page-copy',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html
        .replace('%FOLUME_LOCALE%', () => escapeHtml(strings.locale))
        .replace('%FOLUME_TITLE%', () => escapeHtml(strings.brand.name)),
    },
  }],
  build: { outDir: 'dist/client' },
});
