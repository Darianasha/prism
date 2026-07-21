import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

// Signed httpOnly cookie holding the demo identity. The HMAC stops a user from
// editing the cookie to impersonate someone else. Not real auth — demo only.
export const AUTH_COOKIE = "prism_user";
const SECRET = process.env.PRISM_AUTH_SECRET ?? "dev-insecure-secret-change-me";

export interface SessionUser {
  userId: string;
  username: string;
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function encodeUser(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionUser;
  } catch {
    return null;
  }
}

/** Reads + verifies the signed cookie. Safe to call from server components. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return decodeUser(store.get(AUTH_COOKIE)?.value);
}
