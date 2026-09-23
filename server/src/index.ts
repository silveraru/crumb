import { config } from "./config.js";
import { createDb, migrate } from "./db.js";
import { buildApp } from "./app.js";
import { DevVerifier, TwilioVerifier } from "./sms.js";

const db = createDb(config.databaseUrl);
await migrate(db);

const sms =
  config.smsProvider === "twilio" ? new TwilioVerifier(config.twilio) : new DevVerifier(db, config.phonePepper);

const app = await buildApp({ db, sms, config, logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });
