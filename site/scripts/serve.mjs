import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(
  new URL(
    process.argv.includes("--dist") ? "../dist/" : "../public/",
    import.meta.url,
  ),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(body);
  } catch {
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("WhyJ Quant website: http://127.0.0.1:4173"),
);
