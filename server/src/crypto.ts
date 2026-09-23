import { createHmac, timingSafeEqual } from "node:crypto";

export function hmac(secret: string, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
