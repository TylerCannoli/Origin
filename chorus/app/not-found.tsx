import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-4xl">Page not found</h1>
        <p className="mt-3 text-ink-soft">That page does not exist or you do not have access to it. Casting and listen links can also expire.</p>
        <Link href="/dashboard" className="mt-6 inline-block underline">
          Go to your projects
        </Link>
      </main>
    </>
  );
}
