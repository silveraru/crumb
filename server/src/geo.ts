const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Lat/lng box that contains every point within radiusKm. Used to hit the index before exact filtering. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111.32;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = radiusKm / (111.32 * cosLat);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** SQL expression for haversine distance in km from ($1,$2) — params are passed by the caller. */
export function sqlDistanceKm(latParam: string, lngParam: string, latCol = "lat", lngCol = "lng"): string {
  return `(${2 * EARTH_RADIUS_KM} * asin(least(1.0, sqrt(
    power(sin(radians(${latCol} - ${latParam}) / 2), 2) +
    cos(radians(${latParam})) * cos(radians(${latCol})) * power(sin(radians(${lngCol} - ${lngParam}) / 2), 2)
  ))))`;
}
