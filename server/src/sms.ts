import { randomInt } from "node:crypto";
import type { Db } from "./db.js";
import { hmac, safeEqual } from "./crypto.js";

export interface SmsVerifier {
  start(phone: string): Promise<void>;
  /** Returns true only if the code is correct and unexpired. */
  check(phone: string, code: string): Promise<boolean>;
}

/**
 * Twilio Verify: Twilio generates, sends, and checks the code, and handles
 * per-number throttling and fraud-guard. https://www.twilio.com/docs/verify/api
 */
export class TwilioVerifier implements SmsVerifier {
  constructor(private opts: { accountSid: string; authToken: string; verifyServiceSid: string }) {
    if (!opts.accountSid || !opts.authToken || !opts.verifyServiceSid) {
      throw new Error("Twilio credentials are not configured");
    }
  }

  private async call(path: string, body: Record<string, string>) {
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${this.opts.verifyServiceSid}/${path}`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      },
    );
    return res;
  }

  async start(phone: string) {
    const res = await this.call("Verifications", { To: phone, Channel: "sms" });
    if (!res.ok) throw new Error(`Twilio start failed: ${res.status} ${await res.text()}`);
  }

  async check(phone: string, code: string) {
    const res = await this.call("VerificationCheck", { To: phone, Code: code });
    if (res.status === 404) return false; // expired / already used / too many attempts
    if (!res.ok) throw new Error(`Twilio check failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { status?: string };
    return data.status === "approved";
  }
}

/** Local development: codes are stored hashed in Postgres and printed to the server log. */
export class DevVerifier implements SmsVerifier {
  static readonly TTL_MINUTES = 10;
  static readonly MAX_ATTEMPTS = 5;

  constructor(private db: Db, private pepper: string, private log: (msg: string) => void = console.log) {}

  async start(phone: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.query(
      `INSERT INTO otp_codes (phone_hash, code_hash, attempts, expires_at)
       VALUES ($1, $2, 0, now() + make_interval(mins => $3))
       ON CONFLICT (phone_hash) DO UPDATE
         SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at`,
      [hmac(this.pepper, phone), hmac(this.pepper, code), DevVerifier.TTL_MINUTES],
    );
    this.log(`[dev sms] code for ${phone}: ${code}`);
  }

  async check(phone: string, code: string) {
    const phoneHash = hmac(this.pepper, phone);
    const { rows } = await this.db.query<{ code_hash: Buffer }>(
      `UPDATE otp_codes SET attempts = attempts + 1
       WHERE phone_hash = $1 AND expires_at > now() AND attempts < $2
       RETURNING code_hash`,
      [phoneHash, DevVerifier.MAX_ATTEMPTS],
    );
    if (rows.length === 0) return false;
    const ok = safeEqual(rows[0].code_hash, hmac(this.pepper, code));
    if (ok) await this.db.query(`DELETE FROM otp_codes WHERE phone_hash = $1`, [phoneHash]);
    return ok;
  }
}
