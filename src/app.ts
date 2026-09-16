import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.trustProxyHops);
  app.use(helmet());
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== env.webClientOrigin) {
      console.warn(
        `[cors] отклонён запрос с Origin=${requestOrigin}, а WEB_CLIENT_ORIGIN=${env.webClientOrigin}`,
      );
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next();
  });
  app.use(
    cors({
      origin: env.webClientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser(env.cookieSecret));

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/admin", requireAuth, requireAdmin, adminRouter);

  app.use(errorHandler);

  return app;
}
