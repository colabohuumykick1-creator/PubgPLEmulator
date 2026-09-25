import { createServer } from "node:http";

export function startHealthServer(client) {
  const port = Number(process.env.PORT || 3001);
  const host = "0.0.0.0";

  const server = createServer((request, response) => {
    if (request.url === "/health") {
      const ready = Boolean(client?.isReady?.());

      response.writeHead(ready ? 200 : 503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });

      response.end(
        JSON.stringify({
          status: ready ? "ok" : "starting",
          discord: ready ? "connected" : "connecting",
          bot: client?.user?.tag ?? null,
        }),
      );

      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    response.end(
      client?.isReady?.()
        ? "PubgPLEmulator działa poprawnie."
        : "PubgPLEmulator uruchamia się.",
    );
  });

  server.on("error", (error) => {
    console.error("Błąd serwera kontrolnego:", error);
  });

  server.listen(port, host, () => {
    console.log(
      `Serwer kontrolny działa na porcie ${port} (/health).`,
    );
  });

  return server;
}