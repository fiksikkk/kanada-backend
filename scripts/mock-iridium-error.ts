import readline from "node:readline";
import { WebSocketServer } from "ws";

// Подменяет реальный Kanada Server (Kanada Server/scripts/Ws/
// WsGatewayBridge.js) на время теста - слушает тот же WS-порт и шлёт
// serverError, как будто это сделал HandleError.js на реальном сервере.
// Нужен, чтобы проверить конвейер serverError -> WsGatewayService ->
// AdminNotificationService -> web-client, не трогая боевой IRIDI_SERVER
// (единственный клиент по MaxClients:1 - параллельно подключаться к
// реальному Server со стороны небезопасно, вытеснит backend).
//
// Использование (в отдельном терминале от `npm run dev`):
//   npm run mock:iridium-error
//   IRIDI_SERVER=ws://127.0.0.1:8090 npm run dev
// Дальше Enter в этом терминале шлёт ещё один serverError всем подключённым
// клиентам backend'а.

const PORT = Number(process.argv[2] ?? process.env.MOCK_IRIDIUM_PORT ?? 8090);

function buildServerError(n: number): string {
  return JSON.stringify({
    type: "serverError",
    severity: "error",
    context: "MockIridiumServer",
    message: `тестовая ошибка #${n}`,
    detail: new Date().toISOString(),
  });
}

const wss = new WebSocketServer({ port: PORT });
let counter = 0;

console.log(`[mock-iridium] слушаю ws://127.0.0.1:${PORT}`);
console.log(
  `[mock-iridium] укажи backend'у этот адрес: IRIDI_SERVER=ws://127.0.0.1:${PORT} npm run dev`,
);
console.log("[mock-iridium] Enter - отправить serverError, Ctrl+C - выход");

wss.on("connection", (socket) => {
  console.log("[mock-iridium] backend подключился");
  counter++;
  socket.send(buildServerError(counter));

  socket.on("close", () => console.log("[mock-iridium] backend отключился"));
});

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", () => {
  counter++;
  const payload = buildServerError(counter);
  let sent = 0;
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
      sent++;
    }
  }
  console.log(`[mock-iridium] -> serverError #${counter} отправлен (${sent} клиент(ов))`);
});
