"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  ["", "Overview"],
  ["/casting", "Casting board"],
  ["/script", "Script"],
  ["/review", "Review"],
  ["/listen", "Listen"],
  ["/settings", "Settings"],
] as const;

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="mt-6 flex gap-6 overflow-x-auto border-b border-line text-sm">
      {tabs.map(([suffix, label]) => {
        const href = `${base}${suffix}`;
        const active = suffix === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`-mb-px whitespace-nowrap border-b-2 pb-2 ${active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
