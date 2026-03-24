import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    let filePath = path.join(dist, pathname);
    let ext = path.extname(filePath);
    let content;

    try {
      content = await readFile(filePath);
    } catch {
      if (!ext) {
        filePath = path.join(dist, "index.html");
        ext = ".html";
        content = await readFile(filePath);
      } else {
        throw new Error("not_found");
      }
    }

    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Servidor local en http://localhost:${port}`);
});
