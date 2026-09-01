"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { createSupabaseBrowserClient } from "@/lib/auth/browser";

export function LoginForm({ mode }: { mode: "supabase" | "dev" | "none" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"signin" | "signup" | "magic">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);

  if (mode === "none") {
    return <Notice tone="warn">Sign-in is not configured. Set the Supabase variables or enable CHORUS_DEV_AUTH for local development.</Notice>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "dev") {
        const res = await fetch("/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not sign in");
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured");
      if (tab === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/dashboard` } });
        if (error) throw error;
        setMessage({ tone: "success", text: "Check your email for a sign-in link." });
        return;
      }
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ tone: "success", text: "Account created. Check your email to confirm, then sign in." });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not sign in" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "supabase" ? (
        <div className="flex gap-4 border-b border-line text-sm">
          {(["signin", "signup", "magic"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2 ${tab === t ? "border-ink text-ink" : "border-transparent text-muted"}`}
            >
              {t === "signin" ? "Sign in" : t === "signup" ? "Create account" : "Email link"}
            </button>
          ))}
        </div>
      ) : (
        <Notice tone="info">Local development mode. Enter any email to sign in as that user.</Notice>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      {mode === "supabase" && tab !== "magic" ? (
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === "signup" ? "new-password" : "current-password"} />
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "One moment" : tab === "signup" && mode === "supabase" ? "Create account" : tab === "magic" && mode === "supabase" ? "Send link" : "Sign in"}
      </Button>
    </form>
  );
}
