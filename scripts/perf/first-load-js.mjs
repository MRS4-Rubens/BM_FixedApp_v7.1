import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const nextDir = path.resolve(process.cwd(), '.next');

if (!fs.existsSync(nextDir)) {
  console.error('Error: .next directory does not exist. Run "pnpm build" before measuring first-load JS.');
  process.exit(1);
}

// Manifests list the same chunk as both "/_next/static/…" and "static/…". Normalize BEFORE de-duplicating,
// otherwise every chunk is counted twice.
const normalizeChunkPath = (f) => f.replace(/^\/?_next\//, '');

const ROUTES = [
  { key: '(marketing)/page', label: '/' },
  { key: '(app)/dashboard/page', label: '/dashboard' },
  { key: '(app)/invoices/page', label: '/invoices' },
  { key: '(app)/invoices/new/page', label: '/invoices/new' },
  { key: '(app)/invoices/[id]/page', label: '/invoices/[id]' },
  { key: '(app)/settings/page', label: '/settings' },
  { key: '(app)/reports/page', label: '/reports' },
  { key: '(app)/checkout/page', label: '/checkout' },
  { key: '(admin)/admin/page', label: '/admin' },
];

for (const route of ROUTES) {
  const parts = route.key.split('/');
  const fileName = parts.pop() + '_client-reference-manifest.js';
  const manifestPath = path.join(nextDir, 'server', 'app', ...parts, fileName);

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest not found for route ${route.label} at ${manifestPath}`);
    process.exit(1);
  }

  const src = fs.readFileSync(manifestPath, 'utf8');
  const g = {};
  new Function('globalThis', src)(g);

  const manifest = Object.values(g.__RSC_MANIFEST || {})[0];
  if (!manifest) {
    console.error(`Error: No __RSC_MANIFEST found in ${manifestPath}`);
    process.exit(1);
  }

  const files = new Set();
  if (manifest.entryJSFiles) {
    for (const arr of Object.values(manifest.entryJSFiles)) {
      if (Array.isArray(arr)) {
        for (const f of arr) files.add(normalizeChunkPath(f));
      }
    }
  }

  if (manifest.clientModules) {
    for (const mod of Object.values(manifest.clientModules)) {
      if (mod && Array.isArray(mod.chunks)) {
        for (const f of mod.chunks) files.add(normalizeChunkPath(f));
      }
    }
  }

  let totalGzip = 0;
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const fullPath = path.join(nextDir, f);
    if (fs.existsSync(fullPath)) {
      const buf = fs.readFileSync(fullPath);
      const gz = zlib.gzipSync(buf);
      totalGzip += gz.length;
    }
  }

  const sizeKb = Math.round(totalGzip / 1024);
  console.log(`${route.label.padEnd(20)} ${sizeKb} KB gz`);
}

