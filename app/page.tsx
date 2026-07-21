import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/Sidebar";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { listSessions, getTranscript } from "@/lib/appdb";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return <LoginForm />;

  const chatId = (await searchParams).chat;
  if (!chatId) redirect(`/?chat=${crypto.randomUUID().slice(0, 8)}`);

  const [sessions, transcript] = await Promise.all([
    listSessions(user.userId),
    getTranscript(user.userId, chatId),
  ]);
  const initialMessages = transcript ? JSON.parse(transcript) : [];

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense>
        <Sidebar user={user} sessions={sessions} />
      </Suspense>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Chat chatId={chatId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
