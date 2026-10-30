import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../site-dist");
const args = process.argv.slice(2);
const port = Number(args.find(argument => /^\d+$/.test(argument)) ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Preview port must be an integer between 1 and 65535.");
}
try {
  await stat(join(root, "index.html"));
  await stat(join(root, "asset-manifest.json"));
} catch {
  throw new Error("Build the website first with npm run build.");
}

const base = args.find(arg => arg.startsWith('--base='))?.slice(7) ?? '/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('Invalid preview base path');
const withoutSeasonal = args.includes('--without-seasonal');
// Seasonal styling is a separate theme, never layered with local palettes.
const themes = withoutSeasonal && args.includes('--themes');
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404); response.end('Not found'); return; }
    if (themes && (pathname === `${base}__theme-preview.css` || pathname === `${base}__theme-preview.js` || /^__theme-card-(original|seasonal|harbor|forest|ember)\.svg$/.test(pathname.slice(base.length)))) {
      const file = pathname.endsWith('.css') ? 'themes.css' : pathname.endsWith('.js') ? 'themes.js' : `cards/${pathname.slice(base.length)}`;
      const body = await readFile(join(root, '..', 'theme-preview', file));
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)], 'Cache-Control': 'no-store', 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    let file = resolve(root, './'+pathname.slice(base.length));
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    let body = await readFile(file);
    const integratedThemes = extname(file) === '.html' && body.includes('<!-- theme-control:start -->');
    // Keep the seasonal sheet in its production position for the local theme
    // switcher, but leave it inactive until the seasonal option is selected.
    if (withoutSeasonal && extname(file) === '.html' && (!themes || !integratedThemes)) {
      body = Buffer.from(body.toString('utf8').replace(
        /<link rel="stylesheet" href="(\.\.?\/assets\/seasonal-effects-[^"/]+\.css)"(?: data-theme-seasonal)?\s*\/>/gm,
        themes ? `<link rel="stylesheet" href="$1" media="all" data-theme-seasonal />\n<script>try{const k='damage-calculator-preview-theme',v=new URL(location.href).searchParams.get('preview-theme')||sessionStorage.getItem(k)||'seasonal';if(v!=='seasonal'){document.querySelector('link[data-theme-seasonal]').media='not all';if(['harbor','forest','ember'].includes(v))document.documentElement.dataset.previewTheme=v}}catch{}</script>\n` : '',
      ).replace(/<!-- theme-bootstrap:start -->[\s\S]*?<!-- theme-bootstrap:end -->/g, '')
        .replace(/<!-- theme-control:start -->[\s\S]*?<!-- theme-control:end -->/g, ''));
    }
    if (themes && extname(file) === '.html' && !integratedThemes) {
      body = Buffer.from(body.toString('utf8').replace('</head>', `<link rel="stylesheet" href="${base}__theme-preview.css"><script defer src="${base}__theme-preview.js"></script></head>`));
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": body.length,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    const badRequest = error instanceof URIError || error instanceof TypeError;
    response.writeHead(badRequest ? 400 : 404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(badRequest ? "Bad request" : "Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Preview${withoutSeasonal ? ' without seasonal CSS' : ''}: http://127.0.0.1:${port}${base}`);
});
