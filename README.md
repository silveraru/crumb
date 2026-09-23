# Crumb

Anonymous, hyperlocal posting in the spirit of the original Yik Yak. No profiles, no handles, no groups — just a
feed of short posts from people within ~5 miles of you.

- **Anonymous:** posts and replies show no identity. The only marker is `OP` on replies from the original poster.
- **Verified phone:** sign-in is an SMS code. The number is stored only as an HMAC (`PHONE_PEPPER`), so the DB can't be
  used to look up who someone is, and the API never returns user IDs.
- **Verified location:** every feed/post/vote/reply request carries the device's GPS fix. The server rejects mocked
  locations (Android), fixes worse than 500 m, and "teleporting" faster than an airliner between requests. You can
  only see, vote on, or reply to posts within the radius of where you actually are. Post coordinates are rounded to
  ~110 m before storage, and distance is never returned.
- **Original mechanics:** 200-char posts, New/Hot feeds, up/down votes, content removed at −5, karma, 5 reports
  auto-hides, posts older than 7 days drop out of the feed.

```
server/   Node + Fastify + Postgres API (TypeScript)
app/      Expo (React Native) iOS/Android app, Expo Router
```

## Run locally

```bash
docker compose up -d db            # or any Postgres 14+

cd server
npm install
npm run dev                        # :3000, migrates on boot; SMS codes print to this log
npm test                           # needs a crumb_test database (TEST_DATABASE_URL)

cd ../app
npm install
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000 npx expo start
```

The app uses `expo-location` and `expo-secure-store`, so run it in Expo Go or a dev build on a real device
(simulators let you set any location, which is fine for testing).

## Production checklist

1. Set `JWT_SECRET` and `PHONE_PEPPER` (random, 32+ bytes). **Never rotate `PHONE_PEPPER`** — it would orphan every account.
2. Create a [Twilio Verify](https://www.twilio.com/docs/verify) service and set the `TWILIO_*` vars. Turn on Fraud Guard.
3. Run behind HTTPS. `trustProxy` is on, so per-IP rate limits use `X-Forwarded-For` — make sure your proxy sets it.

## Known limits

- **Location can't be proven from a phone.** A rooted/jailbroken device or a modified client can fake GPS convincingly.
  The server checks raise the bar; they don't make it impossible. Next steps if it matters: App Attest / Play Integrity
  to confirm the request comes from your unmodified app, and IP-geolocation cross-checks.
- **Phone verification ≠ one person.** Burner/VoIP numbers are cheap. Twilio Lookup's line-type check can block
  non-mobile numbers.
- **Anonymity is from other users, not from you.** The server links posts to accounts (needed for moderation, karma,
  and bans). A subpoena or breach exposes which account posted what, though not the phone number without the pepper.
- **Moderation is minimal.** Downvotes + reports only. Anonymous local apps historically attract bullying (it's what
  sank the original); you'll want keyword filters, an admin review queue, and probably an age gate before launch.
