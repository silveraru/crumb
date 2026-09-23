-- Crumb schema. Idempotent: safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC-SHA256(phone, PHONE_PEPPER). The raw number is never stored.
  phone_hash   bytea NOT NULL UNIQUE,
  banned       boolean NOT NULL DEFAULT false,
  last_lat     double precision,
  last_lng     double precision,
  last_loc_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Used only by the dev SMS verifier. Twilio Verify keeps its own state.
CREATE TABLE IF NOT EXISTS otp_codes (
  phone_hash  bytea PRIMARY KEY,
  code_hash   bytea NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  score          int NOT NULL DEFAULT 0,
  comment_count  int NOT NULL DEFAULT 0,
  removed        boolean NOT NULL DEFAULT false,
  -- millisecond precision so ISO-string pagination cursors round-trip exactly
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_geo_idx ON posts (lat, lng);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_idx ON posts (user_id);

CREATE TABLE IF NOT EXISTS comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  score       int NOT NULL DEFAULT 0,
  removed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user_idx ON comments (user_id);

CREATE TABLE IF NOT EXISTS post_votes (
  post_id  uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value    smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comment_votes (
  comment_id  uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  comment_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((post_id IS NULL) <> (comment_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_post_uniq ON reports (user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reports_comment_uniq ON reports (user_id, comment_id) WHERE comment_id IS NOT NULL;
