import * as SecureStore from "expo-secure-store";
import { locationHeader } from "./location";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const TOKEN_KEY = "crumb.token";

export type Vote = -1 | 1 | null;

export interface Post {
  id: string;
  body: string;
  score: number;
  commentCount: number;
  createdAt: string;
  myVote: Vote;
  isMine: boolean;
}

export interface Comment {
  id: string;
  body: string;
  score: number;
  createdAt: string;
  myVote: Vote;
  isMine: boolean;
  isOp: boolean;
}

const FRIENDLY: Record<string, string> = {
  LOCATION_MOCKED: "Mock locations aren't allowed. Turn off any location spoofing apps.",
  LOCATION_INACCURATE: "Your location is too imprecise. Turn on precise location and try again.",
  LOCATION_JUMP: "Your location changed too fast. Try again in a bit.",
  INVALID_CODE: "That code didn't work. Check it or request a new one.",
  BANNED: "This account has been suspended.",
  NOT_FOUND: "That post isn't available here.",
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthenticated: () => void = () => {};

export const auth = {
  async load() {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
    return token;
  },
  async save(t: string) {
    token = t;
    await SecureStore.setItemAsync(TOKEN_KEY, t);
  },
  async clear() {
    token = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
  onUnauthenticated(fn: () => void) {
    onUnauthenticated = fn;
  },
};

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; located?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.located) headers["X-Location"] = await locationHeader();

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      await auth.clear();
      onUnauthenticated();
    }
    const code = data.error ?? "ERROR";
    throw new ApiError(res.status, code, FRIENDLY[code] ?? data.message ?? "Something went wrong");
  }
  return data as T;
}

const located = { located: true };

export const api = {
  startAuth: (phone: string) => request<{ ok: true }>("POST", "/auth/start", { body: { phone } }),
  verifyAuth: (phone: string, code: string) =>
    request<{ token: string }>("POST", "/auth/verify", { body: { phone, code } }),

  me: () => request<{ karma: number }>("GET", "/me"),
  myPosts: () => request<{ posts: Post[] }>("GET", "/me/posts"),
  deleteAccount: () => request<{ ok: true }>("DELETE", "/me"),

  feed: (sort: "new" | "hot", cursor?: { before?: string; offset?: number }) => {
    const q = new URLSearchParams({ sort });
    if (cursor?.before) q.set("before", cursor.before);
    if (cursor?.offset) q.set("offset", String(cursor.offset));
    return request<{ posts: Post[] }>("GET", `/posts?${q}`, located);
  },
  createPost: (body: string) => request<{ post: Post }>("POST", "/posts", { ...located, body: { body } }),
  thread: (id: string) => request<{ post: Post; comments: Comment[] }>("GET", `/posts/${id}`, located),
  deletePost: (id: string) => request<{ ok: true }>("DELETE", `/posts/${id}`),
  reportPost: (id: string, reason: string) =>
    request<{ ok: true }>("POST", `/posts/${id}/report`, { ...located, body: { reason } }),
  votePost: (id: string, value: -1 | 0 | 1) =>
    request<{ score: number; myVote: Vote }>("POST", `/posts/${id}/vote`, { ...located, body: { value } }),

  comment: (postId: string, body: string) =>
    request<{ comment: Comment }>("POST", `/posts/${postId}/comments`, { ...located, body: { body } }),
  deleteComment: (id: string) => request<{ ok: true }>("DELETE", `/comments/${id}`),
  reportComment: (id: string, reason: string) =>
    request<{ ok: true }>("POST", `/comments/${id}/report`, { ...located, body: { reason } }),
  voteComment: (id: string, value: -1 | 0 | 1) =>
    request<{ score: number; myVote: Vote }>("POST", `/comments/${id}/vote`, { ...located, body: { value } }),
};
