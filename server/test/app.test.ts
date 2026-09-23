import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createDb, migrate } from "../src/db.js";
import { DevVerifier } from "../src/sms.js";

const db = createDb(process.env.TEST_DATABASE_URL ?? "postgres://crumb:crumb@localhost:5432/crumb_test");
let codes: Record<string, string> = {};
const sms = new DevVerifier(db, config.phonePepper, (msg) => {
  const m = msg.match(/code for (\S+): (\d+)/)!;
  codes[m[1]] = m[2];
});
const app = await buildApp({ db, sms, config: { ...config, maxPostsPerHour: 3, authStartPerIp: 1000, authVerifyPerIp: 1000 } });

// Downtown SF, ~1km north of it, and Oakland (~13km away).
const SF = "37.7749,-122.4194,20,0";
const SF_NEARBY = "37.7839,-122.4194,20,0";
const OAKLAND = "37.8044,-122.2712,20,0";

async function login(phone: string) {
  await app.inject({ method: "POST", url: "/auth/start", payload: { phone } });
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: codes[phone] } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

function as(token: string, loc: string | null = SF) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (loc) headers["x-location"] = loc;
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers }),
    post: (url: string, payload: object = {}) => app.inject({ method: "POST", url, headers, payload }),
    del: (url: string) => app.inject({ method: "DELETE", url, headers }),
  };
}

beforeAll(async () => {
  await migrate(db);
});
beforeEach(async () => {
  await db.query(`TRUNCATE users, otp_codes CASCADE`);
  codes = {};
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe("phone auth", () => {
  it("rate-limits SMS sends per IP", async () => {
    const strict = await buildApp({ db, sms, config: { ...config, authStartPerIp: 2 } });
    const send = () => strict.inject({ method: "POST", url: "/auth/start", payload: { phone: "+14155550199" } });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
    await strict.close();
  });

  it("rejects non-E.164 numbers", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/start", payload: { phone: "555-1234" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a wrong code and locks out after too many attempts", async () => {
    const phone = "+14155550100";
    await app.inject({ method: "POST", url: "/auth/start", payload: { phone } });
    for (let i = 0; i < DevVerifier.MAX_ATTEMPTS; i++) {
      const bad = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: "000000" === codes[phone] ? "111111" : "000000" } });
      expect(bad.statusCode).toBe(401);
    }
    const good = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: codes[phone] } });
    expect(good.statusCode).toBe(401);
  });

  it("returns the same account for the same number and never stores it in plaintext", async () => {
    const t1 = await login("+14155550101");
    const t2 = await login("+14155550101");
    const { rows } = await db.query(`SELECT * FROM users`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("4155550101");
    expect((await as(t1, null).get("/me")).statusCode).toBe(200);
    expect((await as(t2, null).get("/me")).statusCode).toBe(200);
  });

  it("requires a token", async () => {
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });
});

describe("location validation", () => {
  it("requires a location header for the feed", async () => {
    const t = await login("+14155550102");
    const res = await as(t, null).get("/posts");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("LOCATION_REQUIRED");
  });

  it("rejects mocked and inaccurate locations", async () => {
    const t = await login("+14155550103");
    expect((await as(t, "37.7749,-122.4194,20,1").get("/posts")).json().error).toBe("LOCATION_MOCKED");
    expect((await as(t, "37.7749,-122.4194,5000,0").get("/posts")).json().error).toBe("LOCATION_INACCURATE");
  });

  it("rejects teleporting between requests", async () => {
    const t = await login("+14155550104");
    expect((await as(t, SF).get("/posts")).statusCode).toBe(200);
    const nyc = await as(t, "40.7128,-74.0060,20,0").get("/posts");
    expect(nyc.statusCode).toBe(403);
    expect(nyc.json().error).toBe("LOCATION_JUMP");
    // small GPS drift is fine
    expect((await as(t, SF_NEARBY).get("/posts")).statusCode).toBe(200);
  });
});

describe("local feed", () => {
  it("shows posts only to people within the radius and hides author identity", async () => {
    const a = await login("+14155550110");
    const b = await login("+14155550111");
    const c = await login("+14155550112");

    const created = await as(a, SF).post("/posts", { body: "anyone else hear that?" });
    expect(created.statusCode).toBe(201);

    const near = (await as(b, SF_NEARBY).get("/posts")).json().posts;
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ body: "anyone else hear that?", isMine: false, score: 0 });
    expect(Object.keys(near[0]).sort()).toEqual(
      ["body", "commentCount", "createdAt", "id", "isMine", "myVote", "score"].sort(),
    );

    expect((await as(c, OAKLAND).get("/posts")).json().posts).toHaveLength(0);
    expect((await as(c, OAKLAND).get(`/posts/${near[0].id}`)).statusCode).toBe(404);
  });

  it("stores fuzzed coordinates", async () => {
    const a = await login("+14155550113");
    await as(a, "37.774912,-122.419467,20,0").post("/posts", { body: "hi" });
    const { rows } = await db.query(`SELECT lat, lng FROM posts`);
    expect(rows[0]).toEqual({ lat: 37.775, lng: -122.419 });
  });

  it("validates length and rate-limits posting", async () => {
    const a = await login("+14155550114");
    expect((await as(a).post("/posts", { body: "   " })).statusCode).toBe(400);
    expect((await as(a).post("/posts", { body: "x".repeat(201) })).statusCode).toBe(400);
    for (let i = 0; i < 3; i++) expect((await as(a).post("/posts", { body: `p${i}` })).statusCode).toBe(201);
    expect((await as(a).post("/posts", { body: "one too many" })).statusCode).toBe(429);
  });

  it("paginates the new feed with a cursor", async () => {
    const users = await Promise.all([1, 2, 3].map((i) => login(`+1415555012${i}`)));
    for (const [i, u] of users.entries()) await as(u).post("/posts", { body: `post ${i}` });
    const first = (await as(users[0]).get("/posts")).json().posts;
    expect(first.map((p: any) => p.body)).toEqual(["post 2", "post 1", "post 0"]);
    const next = (await as(users[0]).get(`/posts?before=${encodeURIComponent(first[1].createdAt)}`)).json().posts;
    expect(next.map((p: any) => p.body)).toEqual(["post 0"]);
  });
});

describe("votes, comments, karma", () => {
  it("counts votes, blocks self-votes, and tracks karma", async () => {
    const a = await login("+14155550130");
    const b = await login("+14155550131");
    const post = (await as(a).post("/posts", { body: "hot take" })).json().post;

    expect((await as(a).post(`/posts/${post.id}/vote`, { value: 1 })).statusCode).toBe(400);
    expect((await as(b).post(`/posts/${post.id}/vote`, { value: 1 })).json()).toEqual({ score: 1, myVote: 1 });
    expect((await as(b).post(`/posts/${post.id}/vote`, { value: -1 })).json()).toEqual({ score: -1, myVote: -1 });
    expect((await as(b).post(`/posts/${post.id}/vote`, { value: 0 })).json()).toEqual({ score: 0, myVote: null });
    await as(b).post(`/posts/${post.id}/vote`, { value: 1 });

    expect((await as(a, null).get("/me")).json().karma).toBe(1);
  });

  it("removes a post once it hits -5", async () => {
    const author = await login("+14155550140");
    const post = (await as(author).post("/posts", { body: "bad take" })).json().post;
    for (let i = 0; i < 5; i++) {
      const voter = await login(`+1415555015${i}`);
      await as(voter).post(`/posts/${post.id}/vote`, { value: -1 });
    }
    expect((await as(author).get("/posts")).json().posts).toHaveLength(0);
  });

  it("threads replies and marks the original poster", async () => {
    const op = await login("+14155550160");
    const other = await login("+14155550161");
    const post = (await as(op).post("/posts", { body: "question?" })).json().post;
    await as(other).post(`/posts/${post.id}/comments`, { body: "answer" });
    await as(op).post(`/posts/${post.id}/comments`, { body: "thanks" });

    const thread = (await as(other).get(`/posts/${post.id}`)).json();
    expect(thread.post.commentCount).toBe(2);
    expect(thread.comments.map((c: any) => [c.body, c.isOp, c.isMine])).toEqual([
      ["answer", false, true],
      ["thanks", true, false],
    ]);

    // Someone outside the radius can't reply.
    const far = await login("+14155550162");
    expect((await as(far, OAKLAND).post(`/posts/${post.id}/comments`, { body: "hi" })).statusCode).toBe(404);
  });

  it("hides content after enough reports", async () => {
    const author = await login("+14155550170");
    const post = (await as(author).post("/posts", { body: "spam" })).json().post;
    for (let i = 0; i < 5; i++) {
      const r = await login(`+1415555018${i}`);
      await as(r).post(`/posts/${post.id}/report`, { reason: "spam" });
    }
    expect((await as(author).get("/posts")).json().posts).toHaveLength(0);
  });

  it("deletes the account and its content", async () => {
    const a = await login("+14155550190");
    const b = await login("+14155550191");
    await as(a).post("/posts", { body: "bye" });
    expect((await as(a, null).del("/me")).statusCode).toBe(200);
    expect((await as(a, null).get("/me")).statusCode).toBe(401);
    expect((await as(b).get("/posts")).json().posts).toHaveLength(0);
  });
});
