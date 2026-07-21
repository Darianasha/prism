"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "../../app/auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        action={action}
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0e1220]/90 p-6 shadow-lg shadow-black/20"
      >
        <div className="mb-6 text-center">
          <div className="text-4xl">◇</div>
          <h1 className="mt-3 bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-xl font-bold text-transparent">
            Prism
          </h1>
          <p className="mt-1 text-xs text-slate-500">answers, not walls of text</p>
        </div>

        <label className="block text-xs font-medium text-slate-400">Username</label>
        <input
          name="username"
          autoComplete="username"
          placeholder="e.g. antonio"
          className="mt-1 mb-4 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-500/60"
        />

        <label className="block text-xs font-medium text-slate-400">Password</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="shared demo password"
          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-500/60"
        />

        {state.error && (
          <p className="mt-3 text-xs text-red-400">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          {pending ? "Signing in…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
