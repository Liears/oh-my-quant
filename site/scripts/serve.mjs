import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadContent, renderPage, renderRuntimeMessages, routes } from "./render.mjs";

const preview = process.argv.includes("--dist");
const root = fileURLToPath(
  new URL(
    preview ? "../dist/" : "../public/",
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
    const route = routes.find((entry) => entry.path === pathname);
    if (!pathname.endsWith("/") && routes.some((entry) => entry.path === `${pathname}/`)) {
      res.writeHead(308, { Location: `${pathname}/${new URL(req.url, "http://localhost").search}` }).end();
      return;
    }
    if (!preview && (route || pathname === "/messages.js")) {
      const content = await loadContent();
      const body = route ? renderPage(content, route) : renderRuntimeMessages(content);
      res.writeHead(200, {
        "Content-Type": route ? mime[".html"] : mime[".js"],
        "Cache-Control": "no-store",
      }).end(body);
      return;
    }
    const file = path.resolve(
      root,
      `.${route ? `${pathname}index.html` : pathname}`,
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
