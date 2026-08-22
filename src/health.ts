import http from "node:http";

export function startHealthServer(port = Number(process.env.PORT ?? 3000)): void {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
  });
  server.listen(port, () => console.log(`💚 health endpoint on :${port}`));
}
