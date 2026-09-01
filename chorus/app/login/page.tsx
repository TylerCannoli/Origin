import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { authMode, getSessionUser } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const mode = authMode();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-4xl">Sign in</h1>
        <p className="mt-2 text-ink-soft">Your projects, casts and recordings live under one account.</p>
        <div className="mt-8 rounded-lg border border-line bg-surface p-6">
          <LoginForm mode={mode} />
        </div>
      </main>
    </>
  );
}
