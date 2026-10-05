// Vite build plugin: inlines the JS and CSS bundles into index.html and writes
// a strict Content-Security-Policy <meta> whose script/style hashes match the
// inlined code and whose connect-src is the generated allowlist.
//
// Why inline: Chromium refuses <script type="module" src> from file:// (origin
// "null"), so a file:// build must be a single HTML file. Why hashes: inline
// code would otherwise need 'unsafe-inline'.
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { connectSrcSources } from '../src/data/allowlist';

const sha256 = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export function buildCsp(scriptHashes: string[], styleHashes: string[]): string {
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.join(' ')}`,
    `style-src ${styleHashes.length ? styleHashes.join(' ') : "'none'"}`,
    'img-src data: blob:',
    `connect-src ${connectSrcSources().join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

export function singleFileCsp(): Plugin {
  return {
    name: 'markwatch-singlefile-csp',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') throw new Error('index.html not found in bundle');
      let source = String(html.source);
      const scriptHashes: string[] = [];
      const styleHashes: string[] = [];

      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          // Prevent the inline code from terminating its own <script> element.
          const code = file.code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          if (!tag.test(source)) throw new Error(`script tag for ${file.fileName} not found`);
          source = source.replace(tag, () => `<script type="module">${code}</script>`);
          scriptHashes.push(sha256(code));
          delete bundle[name];
        } else if (file.type === 'chunk') {
          throw new Error(`unexpected extra chunk ${file.fileName}: code splitting must be disabled`);
        }
      }
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css = String(file.source);
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          if (!tag.test(source)) throw new Error(`stylesheet link for ${file.fileName} not found`);
          source = source.replace(tag, () => `<style>${css}</style>`);
          styleHashes.push(sha256(css));
          delete bundle[name];
        }
      }
      source = source.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
      const leftovers = Object.values(bundle).filter((f) => f !== html);
      if (leftovers.length) throw new Error(`assets were not inlined: ${leftovers.map((f) => f.fileName).join(', ')}`);

      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(scriptHashes, styleHashes)}">`;
      if (!source.includes('<!--CSP-->')) throw new Error('index.html is missing the <!--CSP--> marker');
      html.source = source.replace('<!--CSP-->', meta);
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
