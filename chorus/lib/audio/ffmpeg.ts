import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";

export class FFmpegError extends Error {}

/** Thin wrapper over the ffmpeg / ffprobe binaries used by the mock TTS provider and the assembly agent. */
export class FFmpeg {
  constructor(
    private readonly ffmpegPath = env.ffmpegPath,
    private readonly ffprobePath = env.ffprobePath,
  ) {}

  run(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
    return exec(this.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], opts.timeoutMs ?? 10 * 60 * 1000);
  }

  async probeDurationMs(file: string): Promise<number> {
    const out = await exec(this.ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], 60_000);
    const seconds = parseFloat(out.trim());
    if (!Number.isFinite(seconds)) throw new FFmpegError(`Could not read duration of ${file}`);
    return Math.round(seconds * 1000);
  }

  /** Generates a spoken-word-like placeholder: a soft tone burst per word with short gaps. Used by the mock TTS provider. */
  async synthesizePlaceholder(outFile: string, opts: { durationMs: number; frequency: number }): Promise<void> {
    const seconds = Math.max(0.3, opts.durationMs / 1000).toFixed(2);
    // Amplitude-modulated sine so it has syllable-like pulses instead of a flat beep.
    const expr = `0.25*sin(2*PI*${opts.frequency}*t)*(0.55+0.45*sin(2*PI*3.2*t))`;
    await this.run(["-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${seconds}`, "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "96k", outFile]);
  }

  async silence(outFile: string, durationMs: number): Promise<void> {
    await this.run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", (durationMs / 1000).toFixed(3), "-codec:a", "libmp3lame", "-b:a", "96k", outFile]);
  }

  /**
   * Mastering pass for a single clip (§4.6 steps 2-4): high-pass + gentle gate for human
   * recordings, silence trimming at both ends, loudness normalisation to the target LUFS,
   * and resampling to a common format so clips can be concatenated losslessly.
   */
  async masterClip(inFile: string, outFile: string, opts: { human: boolean; targetLufs?: number }): Promise<void> {
    const filters: string[] = [];
    if (opts.human) filters.push("highpass=f=80", "agate=threshold=0.02:ratio=2:attack=5:release=120");
    filters.push(
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15",
      "areverse",
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15",
      "areverse",
      `loudnorm=I=${opts.targetLufs ?? -16}:TP=-1.5:LRA=11`,
      "aresample=44100",
    );
    await this.run(["-i", inFile, "-af", filters.join(","), "-ac", "1", "-ar", "44100", "-codec:a", "pcm_s16le", outFile]);
  }

  /** Concatenates WAV/MP3 parts (same format) into one file via the concat demuxer, then encodes to MP3. */
  async concatToMp3(parts: string[], outFile: string, opts: { metadata?: Record<string, string> } = {}): Promise<void> {
    const list = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "chorus-concat-")), "list.txt");
    await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const meta = Object.entries(opts.metadata ?? {}).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
    await this.run(["-f", "concat", "-safe", "0", "-i", list, ...meta, "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1", outFile]);
  }

  /** Concatenates chapter MP3s into an .m4b audiobook with embedded chapter markers. */
  async concatToM4b(parts: { file: string; title: string; durationMs: number }[], outFile: string, opts: { title: string; artist?: string }): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chorus-m4b-"));
    const list = path.join(dir, "list.txt");
    await fs.writeFile(list, parts.map((p) => `file '${p.file.replace(/'/g, "'\\''")}'`).join("\n"));
    const metaFile = path.join(dir, "chapters.txt");
    let start = 0;
    const lines = [";FFMETADATA1", `title=${escapeMeta(opts.title)}`, `artist=${escapeMeta(opts.artist ?? "Chorus")}`, "genre=Audiobook"];
    for (const p of parts) {
      const end = start + p.durationMs;
      lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${start}`, `END=${end}`, `title=${escapeMeta(p.title)}`);
      start = end;
    }
    await fs.writeFile(metaFile, lines.join("\n"));
    await this.run(["-f", "concat", "-safe", "0", "-i", list, "-i", metaFile, "-map_metadata", "1", "-codec:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "1", "-f", "mp4", outFile]);
  }

  /** Transcodes any browser recording (webm/ogg/mp4/wav) to a normalised WAV for processing. */
  async toWav(inFile: string, outFile: string): Promise<void> {
    await this.run(["-i", inFile, "-ac", "1", "-ar", "44100", "-codec:a", "pcm_s16le", outFile]);
  }
}

function escapeMeta(s: string) {
  return s.replace(/([=;#\\\n])/g, "\\$1");
}

function exec(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FFmpegError(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new FFmpegError(`Could not start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new FFmpegError(`${bin} ${args.slice(0, 6).join(" ")}... exited with ${code}: ${stderr.trim().slice(-800)}`));
    });
  });
}
