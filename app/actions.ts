"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import type { prismAgent } from "@/trigger/agent";
import { getCurrentUser } from "@/lib/auth";
import { ensureSession, getSessionOwner, renameSession, putTranscript } from "@/lib/appdb";

const MAX_TRANSCRIPT_BYTES = 8_000_000; // ~8 MB guard

// The prebuilt action that creates the Session + first run and returns a PAT.
const baseStartChatSession = chat.createStartSessionAction<typeof prismAgent>("prism");

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

async function assertOwns(chatId: string, userId: string) {
  const owner = await getSessionOwner(chatId);
  if (owner && owner !== userId) throw new Error("This chat belongs to another user.");
}

// Registers the chatId under the signed-in user (rejecting someone else's),
// then starts/resumes the durable Trigger session.
export async function startChatSession(params: Parameters<typeof baseStartChatSession>[0]) {
  const user = await requireUser();
  await ensureSession(user.userId, params.chatId);
  return baseStartChatSession(params);
}

// Pure mint, gated on ownership. The transport calls this on 401/403 to refresh.
export async function mintChatAccessToken(chatId: string) {
  const user = await requireUser();
  await assertOwns(chatId, user.userId);
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  });
}

// Titles a session from its first user message (called once, client-side).
export async function setSessionTitle(chatId: string, title: string) {
  const user = await requireUser();
  await assertOwns(chatId, user.userId);
  const clean = title.trim().replace(/\s+/g, " ").slice(0, 80);
  await renameSession(user.userId, chatId, clean || "New chat");
}

// Snapshots the conversation so reopening the session rehydrates it.
export async function saveTranscript(chatId: string, messagesJson: string) {
  const user = await requireUser();
  await assertOwns(chatId, user.userId);
  if (messagesJson.length > MAX_TRANSCRIPT_BYTES) return; // skip oversized snapshots
  await putTranscript(user.userId, chatId, messagesJson);
}
