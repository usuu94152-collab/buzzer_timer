const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = __dirname;
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 5190);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/manifest+json; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const target = path.normalize(path.join(root, requestedPath));

  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);

  console.log(`Buzzer web timer running at http://127.0.0.1:${port}`);
  for (const address of addresses) {
    console.log(`LAN: ${address}`);
  }
});
