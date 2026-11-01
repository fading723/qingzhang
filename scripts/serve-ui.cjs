// Serves the exported acceptance build on loopback only. No user data or uploads.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../artifacts/ui-web');
const port = Number(process.argv[3] || 8084);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
http
  .createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (file !== root && !file.startsWith(root + path.sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const contents = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(contents);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Qingzhang preview: http://127.0.0.1:${port}`));
