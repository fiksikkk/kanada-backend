import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requiredHexKey(name: string, byteLength: number): Buffer {
  const value = required(name);
  const buffer = Buffer.from(value, "hex");
  if (buffer.length !== byteLength) {
    throw new Error(
      `Env var ${name} must be a ${byteLength * 2}-char hex string (${byteLength} bytes)`,
    );
  }
  return buffer;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  cookieSecret: required("COOKIE_SECRET"),
  webClientOrigin: required("WEB_CLIENT_ORIGIN"),
  totpEncryptionKey: requiredHexKey("TOTP_ENCRYPTION_KEY", 32),
  rateLimit: Number(process.env.RATE_LIMIT ?? 10),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  iridiServerUrl: required("IRIDI_SERVER"),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),
};
