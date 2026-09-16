import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const loginRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

export const twoFactorRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});
