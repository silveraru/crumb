import * as Location from "expo-location";

export class LocationUnavailable extends Error {}

let cached: { header: string; at: number } | null = null;
const MAX_AGE_MS = 60_000;

/**
 * Current position encoded for the server's X-Location header:
 * "lat,lng,accuracyMeters,mocked". Refreshed at most once a minute.
 */
export async function locationHeader(force = false): Promise<string> {
  if (!force && cached && Date.now() - cached.at < MAX_AGE_MS) return cached.header;

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    throw new LocationUnavailable("Crumb needs your location to show what's happening nearby.");
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude, accuracy } = pos.coords;
  // `mocked` is only reported on Android; iOS has no public equivalent.
  const header = [
    latitude.toFixed(6),
    longitude.toFixed(6),
    Math.round(accuracy ?? 9999),
    pos.mocked ? 1 : 0,
  ].join(",");
  cached = { header, at: Date.now() };
  return header;
}
