import { Router } from "express";
import { requireCsrf } from "../middleware/csrf.js";
import type { BackupService } from "../services/BackupService.js";

// Фабрика, а не модульный singleton-router как в admin.routes.ts - сервис
// живёт внутри WsGatewayService (BackupService.send замкнут на апстрим-
// соединение к iRidium Server), поэтому инстанс приходит снаружи.
export function createBackupsRouter(backupService: BackupService): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const backups = await backupService.listBackups();
    res.json({ backups });
  });

  router.post("/", requireCsrf, async (_req, res) => {
    try {
      const result = await backupService.triggerManualBackup();
      res.status(201).json({ file: result.file });
    } catch (err) {
      res.status(502).json({ error: "backup_failed", detail: (err as Error).message });
    }
  });

  router.post("/:file/restore", requireCsrf, async (req, res) => {
    const file = req.params.file;
    if (typeof file !== "string" || !file) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    try {
      await backupService.restoreFromFile(file);
      res.json({ restored: true });
    } catch (err) {
      const message = (err as Error).message;
      if (message === "invalid_backup_file_name") {
        res.status(400).json({ error: "invalid_backup_file_name" });
        return;
      }
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "backup_not_found" });
        return;
      }
      res.status(502).json({ error: "restore_failed", detail: message });
    }
  });

  return router;
}
