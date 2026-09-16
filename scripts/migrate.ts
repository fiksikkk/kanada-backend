import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "db",
  "migrations",
);

async function main(): Promise<void> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS auth");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.schema_migrations (
      filename     TEXT PRIMARY KEY,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM auth.schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO auth.schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`apply ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
