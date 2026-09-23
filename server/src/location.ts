import type { Db } from "./db.js";
import { haversineKm } from "./geo.js";

export interface Location {
  lat: number;
  lng: number;
  accuracyM: number;
  mocked: boolean;
}

export interface LocationRules {
  maxAccuracyM: number;
  maxSpeedMps: number;
  travelGraceKm: number;
}

export type LocationError =
  | "LOCATION_REQUIRED"
  | "LOCATION_INVALID"
  | "LOCATION_INACCURATE"
  | "LOCATION_MOCKED"
  | "LOCATION_JUMP";

/**
 * Parses the `X-Location` header: "lat,lng,accuracyMeters,mocked" (mocked is 0/1).
 * Clients send it on every request that touches the feed.
 */
export function parseLocationHeader(value: string | string[] | undefined): Location | LocationError {
  if (!value || Array.isArray(value)) return "LOCATION_REQUIRED";
  const parts = value.split(",");
  if (parts.length !== 4) return "LOCATION_INVALID";
  const [lat, lng, accuracyM] = parts.slice(0, 3).map(Number);
  const mocked = parts[3].trim();
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(accuracyM) || accuracyM < 0 ||
    (mocked !== "0" && mocked !== "1")
  ) {
    return "LOCATION_INVALID";
  }
  return { lat, lng, accuracyM, mocked: mocked === "1" };
}

/**
 * Server-side plausibility checks. GPS is client-reported, so this cannot prove
 * where someone is; it rejects the cheap cheats: coarse fixes, OS-flagged mock
 * locations, and teleporting between requests.
 */
export async function checkLocation(
  db: Db,
  userId: string,
  loc: Location,
  rules: LocationRules,
): Promise<LocationError | null> {
  if (loc.mocked) return "LOCATION_MOCKED";
  if (loc.accuracyM > rules.maxAccuracyM) return "LOCATION_INACCURATE";

  const { rows } = await db.query<{ last_lat: number | null; last_lng: number | null; elapsed_s: number | null }>(
    `SELECT last_lat, last_lng, extract(epoch FROM now() - last_loc_at)::float AS elapsed_s
     FROM users WHERE id = $1`,
    [userId],
  );
  const prev = rows[0];
  if (prev && prev.last_lat !== null && prev.last_lng !== null && prev.elapsed_s !== null) {
    const km = haversineKm(prev.last_lat, prev.last_lng, loc.lat, loc.lng);
    const speed = (km * 1000) / Math.max(prev.elapsed_s, 1);
    if (km > rules.travelGraceKm && speed > rules.maxSpeedMps) return "LOCATION_JUMP";
  }

  await db.query(
    `UPDATE users SET last_lat = $2, last_lng = $3, last_loc_at = now() WHERE id = $1`,
    [userId, loc.lat, loc.lng],
  );
  return null;
}
