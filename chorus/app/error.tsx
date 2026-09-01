"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-4xl">Something went wrong</h1>
      <p className="mt-3 text-ink-soft">The page hit an error it could not recover from. Your data is safe; try again or go back to your projects.</p>
      {error.digest ? <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className="inline-flex items-center px-2 text-ink-soft hover:underline">
          Back to projects
        </Link>
      </div>
    </main>
  );
}
