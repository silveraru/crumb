import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { Db } from "./db.js";
import type { SmsVerifier } from "./sms.js";
import { hmac } from "./crypto.js";
import { boundingBox, sqlDistanceKm } from "./geo.js";
import { checkLocation, parseLocationHeader, type Location } from "./location.js";
import type { config as Config } from "./config.js";

type AppConfig = typeof Config;

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    loc: Location;
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;

// Stored post coordinates are rounded to ~110m so the DB never holds a poster's exact spot.
const fuzz = (n: number) => Math.round(n * 1000) / 1000;

function fail(reply: FastifyReply, status: number, error: string, message?: string) {
  return reply.code(status).send({ error, message: message ?? error });
}

export async function buildApp(opts: { db: Db; sms: SmsVerifier; config: AppConfig; logger?: boolean }) {
  const { db, sms, config } = opts;
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const jwtKey = new TextEncoder().encode(config.jwtSecret);

  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.decorateRequest("userId", "");
  app.decorateRequest("loc", null as unknown as Location);

  // ---------- hooks ----------

  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return fail(reply, 401, "UNAUTHENTICATED");
    try {
      const { payload } = await jwtVerify(header.slice(7), jwtKey);
      const { rows } = await db.query<{ banned: boolean }>(`SELECT banned FROM users WHERE id = $1`, [payload.sub]);
      if (rows.length === 0) return fail(reply, 401, "UNAUTHENTICATED");
      if (rows[0].banned) return fail(reply, 403, "BANNED");
      req.userId = payload.sub as string;
    } catch {
      return fail(reply, 401, "UNAUTHENTICATED");
    }
  }

  async function requireLocation(req: FastifyRequest, reply: FastifyReply) {
    const loc = parseLocationHeader(req.headers["x-location"]);
    if (typeof loc === "string") return fail(reply, 400, loc);
    const err = await checkLocation(db, req.userId, loc, config);
    if (err) return fail(reply, 403, err);
    req.loc = loc;
  }

  const local = { preHandler: [requireAuth, requireLocation] };

  /** Loads a post the caller is allowed to interact with: visible and within their radius. */
  async function loadLocalPost(req: FastifyRequest, postId: string) {
    const { rows } = await db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM posts
       WHERE id = $1 AND NOT removed AND ${sqlDistanceKm("$2", "$3")} <= $4`,
      [postId, req.loc.lat, req.loc.lng, config.feedRadiusKm],
    );
    return rows[0] ?? null;
  }

  const uuid = z.object({ id: z.uuid() });

  // ---------- auth ----------

  app.post(
    "/auth/start",
    { config: { rateLimit: { max: config.authStartPerIp, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = z.object({ phone: z.string().regex(E164) }).safeParse(req.body);
      if (!body.success) return fail(reply, 400, "INVALID_PHONE", "Use international format, e.g. +14155551234");
      await sms.start(body.data.phone);
      return { ok: true };
    },
  );

  app.post(
    "/auth/verify",
    { config: { rateLimit: { max: config.authVerifyPerIp, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = z
        .object({ phone: z.string().regex(E164), code: z.string().regex(/^\d{4,8}$/) })
        .safeParse(req.body);
      if (!body.success) return fail(reply, 400, "INVALID_INPUT");
      if (!(await sms.check(body.data.phone, body.data.code))) return fail(reply, 401, "INVALID_CODE");

      const phoneHash = hmac(config.phonePepper, body.data.phone);
      const { rows } = await db.query<{ id: string; banned: boolean }>(
        `INSERT INTO users (phone_hash) VALUES ($1)
         ON CONFLICT (phone_hash) DO UPDATE SET phone_hash = EXCLUDED.phone_hash
         RETURNING id, banned`,
        [phoneHash],
      );
      if (rows[0].banned) return fail(reply, 403, "BANNED");
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(rows[0].id)
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(jwtKey);
      return { token };
    },
  );

  // ---------- me ----------

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const { rows } = await db.query<{ karma: number }>(
      `SELECT (SELECT coalesce(sum(score), 0) FROM posts WHERE user_id = $1)
            + (SELECT coalesce(sum(score), 0) FROM comments WHERE user_id = $1) AS karma`,
      [req.userId],
    );
    return { karma: Number(rows[0].karma) };
  });

  app.get("/me/posts", { preHandler: requireAuth }, async (req) => {
    const { rows } = await db.query(
      `SELECT id, body, score, comment_count, created_at, NULL::smallint AS my_vote, true AS is_mine
       FROM posts WHERE user_id = $1 AND NOT removed ORDER BY created_at DESC LIMIT 100`,
      [req.userId],
    );
    return { posts: rows.map(toPost) };
  });

  // Deletes the account and everything it posted (App Store requirement).
  app.delete("/me", { preHandler: requireAuth }, async (req) => {
    await db.query(`DELETE FROM users WHERE id = $1`, [req.userId]);
    return { ok: true };
  });

  // ---------- feed ----------

  app.get("/posts", local, async (req, reply) => {
    const q = z
      .object({
        sort: z.enum(["new", "hot"]).default("new"),
        before: z.iso.datetime({ offset: true }).optional(),
        offset: z.coerce.number().int().min(0).max(500).default(0),
      })
      .safeParse(req.query);
    if (!q.success) return fail(reply, 400, "INVALID_INPUT");
    const { lat, lng } = req.loc;
    const box = boundingBox(lat, lng, config.feedRadiusKm);
    const params: unknown[] = [
      lat, lng, config.feedRadiusKm, req.userId, config.feedMaxAgeHours,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ];
    let cursor = "";
    if (q.data.sort === "new" && q.data.before) {
      params.push(q.data.before);
      cursor = `AND p.created_at < $${params.length}`;
    }
    const order =
      q.data.sort === "hot"
        ? `(p.score + 1) / power(extract(epoch FROM now() - p.created_at) / 3600 + 2, 1.5) DESC`
        : `p.created_at DESC`;
    const offset = q.data.sort === "hot" ? q.data.offset : 0;

    const { rows } = await db.query(
      `SELECT p.id, p.body, p.score, p.comment_count, p.created_at, v.value AS my_vote, p.user_id = $4 AS is_mine
       FROM posts p
       LEFT JOIN post_votes v ON v.post_id = p.id AND v.user_id = $4
       WHERE NOT p.removed
         AND p.created_at > now() - make_interval(hours => $5)
         AND p.lat BETWEEN $6 AND $7 AND p.lng BETWEEN $8 AND $9
         AND ${sqlDistanceKm("$1", "$2", "p.lat", "p.lng")} <= $3
         ${cursor}
       ORDER BY ${order}
       LIMIT 50 OFFSET ${offset}`,
      params,
    );
    return { posts: rows.map(toPost) };
  });

  app.post("/posts", local, async (req, reply) => {
    const body = z.object({ body: z.string().trim().min(1).max(config.maxPostLength) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "INVALID_INPUT", `Posts must be 1–${config.maxPostLength} characters`);
    const { rows: recent } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM posts WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [req.userId],
    );
    if (recent[0].n >= config.maxPostsPerHour) return fail(reply, 429, "SLOW_DOWN", "You're posting too fast");

    const { rows } = await db.query(
      `INSERT INTO posts (user_id, body, lat, lng) VALUES ($1, $2, $3, $4)
       RETURNING id, body, score, comment_count, created_at, NULL::smallint AS my_vote, true AS is_mine`,
      [req.userId, body.data.body, fuzz(req.loc.lat), fuzz(req.loc.lng)],
    );
    return reply.code(201).send({ post: toPost(rows[0]) });
  });

  app.get("/posts/:id", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    const post = await loadLocalPost(req, p.data.id);
    if (!post) return fail(reply, 404, "NOT_FOUND");

    const { rows: postRows } = await db.query(
      `SELECT p.id, p.body, p.score, p.comment_count, p.created_at, v.value AS my_vote, p.user_id = $2 AS is_mine
       FROM posts p LEFT JOIN post_votes v ON v.post_id = p.id AND v.user_id = $2
       WHERE p.id = $1`,
      [post.id, req.userId],
    );
    const { rows: commentRows } = await db.query(
      `SELECT c.id, c.body, c.score, c.created_at, v.value AS my_vote,
              c.user_id = $2 AS is_mine, c.user_id = $3 AS is_op
       FROM comments c LEFT JOIN comment_votes v ON v.comment_id = c.id AND v.user_id = $2
       WHERE c.post_id = $1 AND NOT c.removed
       ORDER BY c.created_at ASC`,
      [post.id, req.userId, post.user_id],
    );
    return { post: toPost(postRows[0]), comments: commentRows.map(toComment) };
  });

  app.delete("/posts/:id", { preHandler: requireAuth }, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    const { rowCount } = await db.query(
      `UPDATE posts SET removed = true WHERE id = $1 AND user_id = $2`,
      [p.data.id, req.userId],
    );
    if (!rowCount) return fail(reply, 404, "NOT_FOUND");
    return { ok: true };
  });

  // ---------- comments ----------

  app.post("/posts/:id/comments", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    const body = z.object({ body: z.string().trim().min(1).max(config.maxCommentLength) }).safeParse(req.body);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    if (!body.success) return fail(reply, 400, "INVALID_INPUT", `Replies must be 1–${config.maxCommentLength} characters`);
    const post = await loadLocalPost(req, p.data.id);
    if (!post) return fail(reply, 404, "NOT_FOUND");

    const { rows: recent } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM comments WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [req.userId],
    );
    if (recent[0].n >= config.maxCommentsPerHour) return fail(reply, 429, "SLOW_DOWN", "You're replying too fast");

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO comments (post_id, user_id, body) VALUES ($1, $2, $3)
         RETURNING id, body, score, created_at, NULL::smallint AS my_vote, true AS is_mine, user_id = $4 AS is_op`,
        [post.id, req.userId, body.data.body, post.user_id],
      );
      await client.query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [post.id]);
      await client.query("COMMIT");
      return reply.code(201).send({ comment: toComment(rows[0]) });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete("/comments/:id", { preHandler: requireAuth }, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    const { rows } = await db.query<{ post_id: string }>(
      `UPDATE comments SET removed = true WHERE id = $1 AND user_id = $2 AND NOT removed RETURNING post_id`,
      [p.data.id, req.userId],
    );
    if (rows.length === 0) return fail(reply, 404, "NOT_FOUND");
    await db.query(`UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`, [rows[0].post_id]);
    return { ok: true };
  });

  // ---------- votes ----------

  const voteBody = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

  async function applyVote(
    kind: "post" | "comment",
    targetId: string,
    userId: string,
    value: -1 | 0 | 1,
  ): Promise<number> {
    const table = kind === "post" ? "posts" : "comments";
    const votes = kind === "post" ? "post_votes" : "comment_votes";
    const col = kind === "post" ? "post_id" : "comment_id";
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Lock the target row so concurrent votes serialize.
      const { rows: target } = await client.query<{ removed: boolean }>(
        `SELECT removed FROM ${table} WHERE id = $1 FOR UPDATE`,
        [targetId],
      );
      const { rows: prev } = await client.query<{ value: number }>(
        `SELECT value FROM ${votes} WHERE ${col} = $1 AND user_id = $2`,
        [targetId, userId],
      );
      const delta = value - (prev[0]?.value ?? 0);
      if (value === 0) {
        await client.query(`DELETE FROM ${votes} WHERE ${col} = $1 AND user_id = $2`, [targetId, userId]);
      } else {
        await client.query(
          `INSERT INTO ${votes} (${col}, user_id, value) VALUES ($1, $2, $3)
           ON CONFLICT (${col}, user_id) DO UPDATE SET value = EXCLUDED.value`,
          [targetId, userId, value],
        );
      }
      // Hitting the threshold removes content permanently, like the original.
      const { rows } = await client.query<{ score: number; removed: boolean; post_id: string | null }>(
        `UPDATE ${table} SET score = score + $2, removed = removed OR score + $2 <= $3
         WHERE id = $1 RETURNING score, removed, ${kind === "comment" ? "post_id" : "NULL::uuid AS post_id"}`,
        [targetId, delta, config.removeAtScore],
      );
      if (kind === "comment" && rows[0].removed && !target[0].removed) {
        await client.query(`UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`, [rows[0].post_id]);
      }
      await client.query("COMMIT");
      return rows[0].score;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  app.post("/posts/:id/vote", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    const body = voteBody.safeParse(req.body);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    if (!body.success) return fail(reply, 400, "INVALID_INPUT");
    const post = await loadLocalPost(req, p.data.id);
    if (!post) return fail(reply, 404, "NOT_FOUND");
    if (post.user_id === req.userId) return fail(reply, 400, "OWN_CONTENT", "You can't vote on your own post");
    const score = await applyVote("post", post.id, req.userId, body.data.value);
    return { score, myVote: body.data.value || null };
  });

  app.post("/comments/:id/vote", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    const body = voteBody.safeParse(req.body);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    if (!body.success) return fail(reply, 400, "INVALID_INPUT");
    const { rows } = await db.query<{ id: string; user_id: string; post_id: string }>(
      `SELECT id, user_id, post_id FROM comments WHERE id = $1 AND NOT removed`,
      [p.data.id],
    );
    const comment = rows[0];
    if (!comment || !(await loadLocalPost(req, comment.post_id))) return fail(reply, 404, "NOT_FOUND");
    if (comment.user_id === req.userId) return fail(reply, 400, "OWN_CONTENT", "You can't vote on your own reply");
    const score = await applyVote("comment", comment.id, req.userId, body.data.value);
    return { score, myVote: body.data.value || null };
  });

  // ---------- reports ----------

  const REPORTS_TO_HIDE = 5;
  const reportBody = z.object({ reason: z.string().trim().min(1).max(200) });

  app.post("/posts/:id/report", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    const body = reportBody.safeParse(req.body);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    if (!body.success) return fail(reply, 400, "INVALID_INPUT");
    const post = await loadLocalPost(req, p.data.id);
    if (!post) return fail(reply, 404, "NOT_FOUND");
    await db.query(
      `INSERT INTO reports (user_id, post_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.userId, post.id, body.data.reason],
    );
    await db.query(
      `UPDATE posts SET removed = true
       WHERE id = $1 AND (SELECT count(*) FROM reports WHERE post_id = $1) >= $2`,
      [post.id, REPORTS_TO_HIDE],
    );
    return { ok: true };
  });

  app.post("/comments/:id/report", local, async (req, reply) => {
    const p = uuid.safeParse(req.params);
    const body = reportBody.safeParse(req.body);
    if (!p.success) return fail(reply, 404, "NOT_FOUND");
    if (!body.success) return fail(reply, 400, "INVALID_INPUT");
    const { rows } = await db.query<{ id: string; post_id: string }>(
      `SELECT id, post_id FROM comments WHERE id = $1 AND NOT removed`,
      [p.data.id],
    );
    if (!rows[0] || !(await loadLocalPost(req, rows[0].post_id))) return fail(reply, 404, "NOT_FOUND");
    await db.query(
      `INSERT INTO reports (user_id, comment_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.userId, rows[0].id, body.data.reason],
    );
    const { rowCount } = await db.query(
      `UPDATE comments SET removed = true
       WHERE id = $1 AND NOT removed AND (SELECT count(*) FROM reports WHERE comment_id = $1) >= $2`,
      [rows[0].id, REPORTS_TO_HIDE],
    );
    if (rowCount) {
      await db.query(`UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`, [rows[0].post_id]);
    }
    return { ok: true };
  });

  app.get("/health", async () => ({ ok: true }));

  return app;
}

// ---------- serializers (never expose user_id, phone, or coordinates) ----------

function toPost(r: any) {
  return {
    id: r.id as string,
    body: r.body as string,
    score: r.score as number,
    commentCount: r.comment_count as number,
    createdAt: (r.created_at as Date).toISOString(),
    myVote: (r.my_vote ?? null) as -1 | 1 | null,
    isMine: Boolean(r.is_mine),
  };
}

function toComment(r: any) {
  return {
    id: r.id as string,
    body: r.body as string,
    score: r.score as number,
    createdAt: (r.created_at as Date).toISOString(),
    myVote: (r.my_vote ?? null) as -1 | 1 | null,
    isMine: Boolean(r.is_mine),
    isOp: Boolean(r.is_op),
  };
}
