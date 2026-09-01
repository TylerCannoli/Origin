import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Wave } from "@/components/ui/wave";

const sampleCast = [
  { name: "Narrator", lines: 412, who: "AI voice · Marlowe" },
  { name: "Elizabeth March", lines: 85, who: "Voiced by Priya" },
  { name: "Captain Reyes", lines: 61, who: "Voiced by Dad" },
  { name: "The Innkeeper", lines: 9, who: "Waiting for a reader" },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-16 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <h1 className="text-5xl leading-[1.05] md:text-6xl">
              A table read with friends, stitched into an audiobook.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Upload a manuscript. Chorus finds every character and every line, then hands each part to whoever you
              invite. Anyone can record from their phone. Unclaimed parts get an AI voice, so the book is always complete.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/login" size="lg">
                Start a project
              </ButtonLink>
              <Link href="#how" className="inline-flex items-center px-2 py-2.5 text-ink-soft hover:underline">
                See how it works
              </Link>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center justify-between text-sm text-muted">
              <span>Little Women, chapter 1</span>
              <Wave bars={16} live className="text-gold" />
            </div>
            <ul className="mt-4 divide-y divide-line">
              {sampleCast.map((c) => (
                <li key={c.name} className="flex items-baseline justify-between py-3">
                  <div>
                    <div className="display text-lg">{c.name}</div>
                    <div className="text-sm text-muted">{c.who}</div>
                  </div>
                  <span className="text-sm text-ink-soft">{c.lines} lines</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-3xl">How it works</h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-4">
              {[
                ["Upload", "Bring a .txt, .docx, .epub or .pdf you have the rights to, or paste the text."],
                ["Cast", "Chorus lists every character with a short voice note and a suggested AI voice. Merge, rename, or drop the minor ones."],
                ["Record", "Share a link per character. Readers see only their lines and record them right in the browser."],
                ["Listen", "Generate the audiobook. Human takes and AI fallbacks are levelled, paced and stitched by chapter."],
              ].map(([title, body], i) => (
                <li key={title} className="border-t-2 border-ink pt-4">
                  <div className="text-sm text-muted">Step {i + 1}</div>
                  <h3 className="mt-1 text-xl">{title}</h3>
                  <p className="mt-2 text-ink-soft">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-3xl">Made for</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {[
              ["Indie authors", "A low-cost audiobook with personality, produced with friends and fans."],
              ["Book clubs", "A collaborative read of a favourite public-domain novel, one character each."],
              ["Voice actors", "Bite-sized parts to practise and perform, with delivery notes on every line."],
              ["Parents", "A bedtime story in your own voices, with you playing every part if you like."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-lg border border-line bg-surface p-5">
                <h3 className="text-xl">{t}</h3>
                <p className="mt-1 text-ink-soft">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-muted">
            Chorus only processes text you own or have rights to. Projects are private by default and recordings are used
            inside your project only.
          </p>
        </section>
      </main>
    </>
  );
}
