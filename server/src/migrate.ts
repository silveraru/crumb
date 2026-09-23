import { config } from "./config.js";
import { createDb, migrate } from "./db.js";

const db = createDb(config.databaseUrl);
await migrate(db);
await db.end();
console.log("migrated");
