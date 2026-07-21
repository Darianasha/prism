"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, encodeUser } from "@/lib/auth";
import { upsertUser } from "@/lib/appdb";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface SignInState {
  error?: string;
}

/** username + shared password. Wrong password (or missing name) is rejected. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username) return { error: "Enter a username." };
  const expected = process.env.PRISM_DEMO_PASSWORD;
  if (!expected) return { error: "PRISM_DEMO_PASSWORD is not set on the server." };
  if (password !== expected) return { error: "Wrong password." };

  const userId = slugify(username);
  if (!userId) return { error: "Username must contain letters or numbers." };

  await upsertUser(userId, username);

  const store = await cookies();
  store.set(AUTH_COOKIE, encodeUser({ userId, username }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect("/");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect("/");
}
