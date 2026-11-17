import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const publicAsset = path => new URL('./public' + path, import.meta.url);
const staticFiles = [
  '/offline.html', '/reconnect.js', '/mark.svg', '/manifest.webmanifest',
  '/icons/app-192.png', '/icons/app-512.png', '/icons/maskable.png', '/icons/apple-touch.png', '/icons/badge.png'
];

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [{
    name: 'show-up-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const worker = readFileSync(new URL('./pwa/worker.js', import.meta.url), 'utf8');
      const assets = [...staticFiles, ...Object.keys(bundle).filter(path => path.startsWith('assets/')).map(path => '/' + path)].sort();
      const hash = createHash('sha256').update(worker).update(JSON.stringify(assets));
      for (const path of staticFiles) hash.update(readFileSync(publicAsset(path)));
      const source = worker.replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
        .replace('__BUILD_ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  }]
});
