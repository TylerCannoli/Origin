import Link from "next/link";
import { getSessionUser } from "@/lib/auth/server";
import { Wave } from "@/components/ui/wave";

export async function SiteHeader() {
  const user = await getSessionUser();
  return (
    <header className="border-b border-line bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 text-lg display">
          <Wave bars={7} className="text-gold" seed={5} />
          Chorus
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/dashboard" className="hover:underline">
                Projects
              </Link>
              <form action="/api/auth/signout" method="post">
                <button className="text-muted hover:text-ink">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/#how" className="hover:underline">
                How it works
              </Link>
              <Link href="/login" className="rounded-md border border-ink px-3 py-1.5 hover:bg-ink hover:text-surface-strong">
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
