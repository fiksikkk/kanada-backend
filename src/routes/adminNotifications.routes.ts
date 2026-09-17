import { Router } from "express";
import { requireCsrf } from "../middleware/csrf.js";
import type { AdminNotificationService } from "../services/AdminNotificationService.js";

// Фабрика, а не модульный singleton-router (как backups.routes.ts) - сервис
// живёт внутри WsGatewayService (push замкнут на список браузерных
// соединений), поэтому инстанс приходит снаружи.
export function createAdminNotificationsRouter(
  service: AdminNotificationService,
): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const beforeRaw = req.query.before;
    let before: number | undefined;
    if (typeof beforeRaw === "string" && beforeRaw !== "") {
      before = Number(beforeRaw);
      if (!Number.isInteger(before) || before <= 0) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
    }

    const [{ notifications, hasMore }, unreadCount] = await Promise.all([
      service.list({ before }),
      service.unreadCount(),
    ]);
    res.json({ notifications, unreadCount, hasMore });
  });

  router.post("/:id/read", requireCsrf, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    await service.markRead(id);
    res.json({ read: true });
  });

  router.post("/read-all", requireCsrf, async (_req, res) => {
    await service.markAllRead();
    res.json({ read: true });
  });

  return router;
}
