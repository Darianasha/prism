"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport, type InferChatUIMessage } from "@trigger.dev/sdk/chat/react";
import type { prismAgent } from "@/trigger/agent";
import type { RenderOutput } from "@/lib/spec";
import { ComponentRenderer } from "./canvas/ComponentRenderer";
import { mintChatAccessToken, startChatSession } from "../../app/actions";

type Msg = InferChatUIMessage<typeof prismAgent>;
type Part = Msg["parts"][number];

const EXAMPLES = [
  "Why did signups drop last week?",
  "Why was Tuesday slow?",
  "Should I cycle tomorrow in Amsterdam?",
];

type Profile = { audience: string; depth: string; signal: string };

const AUDIENCE_LABEL: Record<string, string> = {
  engineer: "Engineer",
  business: "Exec",
  casual: "Casual",
};

/** Latest update_profile output across the conversation = the active profile. */
function activeProfile(messages: Msg[]): Profile | null {
  let latest: Profile | null = null;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool-update_profile" && p.state === "output-available") {
        latest = p.output as Profile;
      }
    }
  }
  return latest;
}

export function Chat() {
  // Client-only mount gate: the chat id lives in the URL (?chat=...) so a
  // mid-stream refresh reconnects to the same durable session.
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    let id = url.searchParams.get("chat");
    if (!id) {
      id = crypto.randomUUID().slice(0, 8);
      url.searchParams.set("chat", id);
      window.history.replaceState({}, "", url);
    }
    setChatId(id);
  }, []);

  if (!chatId) return null;
  return <ChatSession key={chatId} chatId={chatId} />;
}

function ChatSession({ chatId }: { chatId: string }) {
  const transport = useTriggerChatTransport<typeof prismAgent>({
    task: "prism",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, stop, status } = useChat<Msg>({ id: chatId, transport });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  const newChat = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", crypto.randomUUID().slice(0, 8));
    window.location.href = url.toString();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800/60 bg-[#0a0c12]/90 py-3 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <h1 className="bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-lg font-bold text-transparent">
            ◇ Prism
          </h1>
          <span className="text-xs text-slate-500">answers, not walls of text</span>
        </div>
        <div className="flex items-center gap-3">
          <AudiencePicker
            profile={activeProfile(messages)}
            busy={busy}
            onPick={(audience) =>
              send(
                `View as a ${audience} audience from now on — update my profile and shape future answers accordingly.`
              )
            }
          />
          <button
            onClick={newChat}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            New chat
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-6 py-6">
        {messages.length === 0 && <EmptyState onPick={send} />}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} message={m} />
          ) : (
            <AssistantMessage key={m.id} message={m} onSuggestion={send} busy={busy} />
          )
        )}
        {status === "submitted" && <ThinkingRow label="Waking the agent…" />}
        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 border-t border-slate-800/60 bg-[#0a0c12]/95 py-4 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your data anything…"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-500/60"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-xl border border-red-500/40 px-5 py-3 text-sm font-medium text-red-300 transition hover:bg-red-950/40"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              Ask
            </button>
          )}
        </form>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-6 pt-24 text-center">
      <div>
        <div className="text-5xl">◇</div>
        <h2 className="mt-4 text-2xl font-bold text-slate-100">Ask your data anything</h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Every answer is a rendered, interactive visual straight out of ClickHouse. If the data
          isn&apos;t there yet, the agent goes and gets it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-300 transition hover:border-sky-500/60 hover:text-sky-300"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: Msg }) {
  const text = message.parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-sky-600/90 px-4 py-2.5 text-sm text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  onSuggestion,
  busy,
}: {
  message: Msg;
  onSuggestion: (q: string) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3">
      {message.parts.map((part, i) => (
        <PartView key={i} part={part} onSuggestion={onSuggestion} busy={busy} />
      ))}
    </div>
  );
}

function PartView({
  part,
  onSuggestion,
  busy,
}: {
  part: Part;
  onSuggestion: (q: string) => void;
  busy: boolean;
}) {
  switch (part.type) {
    case "text":
      return part.text.trim() ? (
        <p className="text-[15px] font-medium leading-relaxed text-slate-100">{part.text}</p>
      ) : null;

    case "tool-list_datasets":
      return <ToolChip done={part.state === "output-available"} label="Inspecting datasets" />;

    case "tool-run_query": {
      const done = part.state === "output-available" || part.state === "output-error";
      const sql =
        part.state !== "input-streaming" && part.input ? (part.input as { sql?: string }).sql : undefined;
      return (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <ToolChip done={done} label="Querying ClickHouse" expandable />
          </summary>
          {sql && (
            <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              {sql}
            </pre>
          )}
        </details>
      );
    }

    case "tool-fetch_dataset": {
      const done = part.state === "output-available";
      const out = done ? (part.output as { ok?: boolean; table?: string; rowCount?: number }) : null;
      return (
        <ToolChip
          done={done}
          label={
            out?.ok
              ? `Fetched ${out.rowCount?.toLocaleString()} rows into “${out.table}”`
              : "Fetching external data"
          }
        />
      );
    }

    case "tool-render_component": {
      if (part.state === "output-available") {
        return <ComponentRenderer output={part.output as RenderOutput} />;
      }
      if (part.state === "output-error") {
        return (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-300">
            Render failed: {part.errorText}
          </div>
        );
      }
      return <div className="shimmer h-40 rounded-xl border border-slate-800/60" />;
    }

    case "tool-update_profile": {
      if (part.state !== "output-available") return null;
      const p = part.output as { audience: string; depth: string; signal: string };
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-sky-800/60 bg-sky-950/30 px-3 py-1 text-xs text-sky-300">
          ◎ Now viewing as {AUDIENCE_LABEL[p.audience] ?? p.audience} · {p.depth}
          <span className="text-sky-500/70">— {p.signal}</span>
        </span>
      );
    }

    case "tool-suggest_followups": {
      if (part.state !== "output-available") return null;
      const suggestions = (part.output as { suggestions: string[] }).suggestions ?? [];
      return (
        <div className="flex flex-wrap gap-2 pt-1">
          {suggestions.map((s) => (
            <button
              key={s}
              disabled={busy}
              onClick={() => onSuggestion(s)}
              className="rounded-full border border-violet-500/40 bg-violet-950/20 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-violet-900/40 disabled:opacity-50"
            >
              {s} →
            </button>
          ))}
        </div>
      );
    }

    default:
      return null;
  }
}

function AudiencePicker({
  profile,
  busy,
  onPick,
}: {
  profile: Profile | null;
  busy: boolean;
  onPick: (audience: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
      {(["engineer", "business", "casual"] as const).map((a) => {
        const active = profile?.audience === a;
        return (
          <button
            key={a}
            disabled={busy || active}
            title={active && profile ? `inferred from: ${profile.signal}` : `answer for a ${a} audience`}
            onClick={() => onPick(a)}
            className={`rounded-md px-2 py-1 text-[11px] transition ${
              active
                ? "bg-sky-600/30 font-semibold text-sky-300"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            } disabled:cursor-default`}
          >
            {AUDIENCE_LABEL[a]}
          </button>
        );
      })}
      {!profile && <span className="pr-1.5 text-[10px] text-slate-600">auto</span>}
    </div>
  );
}

function ToolChip({
  done,
  label,
  expandable,
}: {
  done: boolean;
  label: string;
  expandable?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-400">
      {done ? (
        <span className="text-emerald-400">✓</span>
      ) : (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-600 border-t-sky-400" />
      )}
      {label}
      {expandable && <span className="text-slate-600">· sql</span>}
    </span>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border border-slate-600 border-t-sky-400" />
      {label}
    </div>
  );
}
