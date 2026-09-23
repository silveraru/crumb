import pg from "pg";
import { readFile } from "node:fs/promises";

export type Db = pg.Pool;

export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url });
}

export async function migrate(db: Db): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.query(sql);
}
