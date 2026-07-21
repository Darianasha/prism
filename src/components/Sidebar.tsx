"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "../../app/auth-actions";
import type { SessionUser } from "@/lib/auth";
import type { SessionRow } from "@/lib/appdb";

export function Sidebar({ user, sessions }: { user: SessionUser; sessions: SessionRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const activeId = params.get("chat");

  const newChat = () => {
    const id = crypto.randomUUID().slice(0, 8);
    router.push(`/?chat=${id}`);
  };

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-slate-800/60 bg-[#0a0c12]">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-base font-bold text-transparent">
          ◇ Prism
        </span>
      </div>

      <div className="px-3">
        <button
          onClick={newChat}
          className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          + New chat
        </button>
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-slate-600">No conversations yet.</p>
        )}
        {sessions.map((s) => {
          const active = s.session_id === activeId;
          return (
            <Link
              key={s.session_id}
              href={`/?chat=${s.session_id}`}
              className={`block truncate rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-slate-800 font-medium text-slate-100"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
              title={s.title}
            >
              {s.title || "New chat"}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-slate-800/60 px-4 py-3">
        <span className="truncate text-xs text-slate-400" title={user.username}>
          {user.username}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
