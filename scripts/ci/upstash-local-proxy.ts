/**
 * scripts/ci/upstash-local-proxy.ts — CI ONLY (E2E workflow). See upstash-local-proxy-core.ts for why.
 *
 * Listens on 127.0.0.1:PROXY_PORT (default 8080) and forwards every request to SRH (PROXY_TARGET, default
 * http://127.0.0.1:8079), removing the Upstash-only `allow-key-locking` script flag on the way. Responses are passed
 * back unchanged. Never used by the app on Render: there the app talks to Upstash directly.
 */
import { createServer, request as httpRequest } from 'node:http';
import { rewriteBody } from './upstash-local-proxy-core';

const port = Number(process.env.PROXY_PORT ?? '8080');
const target = new URL(process.env.PROXY_TARGET ?? 'http://127.0.0.1:8079');
if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
  throw new Error('upstash-local-proxy only forwards to a local SRH.');
}
const shaMap = new Map<string, string>();

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let payload = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', target);
    if (payload.length > 0) {
      try {
        const rewritten = rewriteBody(url.pathname, JSON.parse(payload.toString('utf8')), shaMap);
        payload = Buffer.from(JSON.stringify(rewritten), 'utf8');
      } catch {
        // Not JSON: forward as is.
      }
    }
    const headers = { ...req.headers, host: target.host, 'content-length': String(payload.length) };
    const upstream = httpRequest(url, { method: req.method, headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstash-local-proxy: SRH unreachable' }));
    });
    upstream.end(payload);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`upstash-local-proxy listening on http://127.0.0.1:${port} -> ${target.origin}`);
});
