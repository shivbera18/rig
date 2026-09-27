import http from "node:http";

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/chat/completions") {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: {"choices":[{"delta":{"content":"hello "}}]}\n\n`);
      res.write(`data: {"choices":[{"delta":{"content":"world"}}]}\n\n`);
      res.write(
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stub1","function":{"name":"read","arguments":"{\\"path\\""}}]}}]}\n\n`,
      );
      res.write(
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stub1","function":{"arguments":":\\"package.json\\"}"}}]}}]}\n\n`,
      );
      res.write(`data: [DONE]\n\n`);
      res.end();
    });
    return;
  }
  res.writeHead(404).end("not found");
});

const port = Number(process.argv[2] ?? 18731);
server.listen(port, "127.0.0.1", () => console.log(`stub listening on 127.0.0.1:${port}`));
