function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(env("PORT", "3000")),
  databaseUrl: env("DATABASE_URL", "postgres://crumb:crumb@localhost:5432/crumb"),
  // Secrets: dev fallbacks only. Production must set them.
  jwtSecret: env("JWT_SECRET", isProd ? undefined : "dev-jwt-secret-change-me"),
  phonePepper: env("PHONE_PEPPER", isProd ? undefined : "dev-phone-pepper-change-me"),

  // "twilio" in production, "dev" logs codes to the console.
  smsProvider: env("SMS_PROVIDER", isProd ? "twilio" : "dev") as "twilio" | "dev",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? "",
  },

  // Locality rules
  feedRadiusKm: Number(env("FEED_RADIUS_KM", "8")), // ~5 miles
  feedMaxAgeHours: Number(env("FEED_MAX_AGE_HOURS", "168")),
  maxAccuracyM: Number(env("MAX_LOCATION_ACCURACY_M", "500")),
  maxSpeedMps: Number(env("MAX_TRAVEL_SPEED_MPS", "280")), // ~ airliner cruise
  travelGraceKm: Number(env("TRAVEL_GRACE_KM", "3")), // GPS jitter allowance

  // Per-IP limits on SMS sends / code checks (per 10 min). SMS pumping fraud is expensive.
  authStartPerIp: Number(env("AUTH_START_PER_IP", "5")),
  authVerifyPerIp: Number(env("AUTH_VERIFY_PER_IP", "10")),

  // Content rules
  maxPostLength: 200,
  maxCommentLength: 200,
  removeAtScore: -5,
  maxPostsPerHour: Number(env("MAX_POSTS_PER_HOUR", "10")),
  maxCommentsPerHour: Number(env("MAX_COMMENTS_PER_HOUR", "60")),
};
