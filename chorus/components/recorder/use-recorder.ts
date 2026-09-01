"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "unsupported" | "denied";

export interface Take {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  url: string;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

/**
 * Microphone recording via MediaRecorder with a live level analyser. Returns a Take with a
 * playable object URL when stopped.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [take, setTake] = useState<Take | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") setState("unsupported");
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        setTake((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { blob, mimeType: type, durationMs, url: URL.createObjectURL(blob) };
        });
        setState("stopped");
        cleanupStream();
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
      recorder.start(250);
      setState("recording");
    } catch (err) {
      cleanupStream();
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
        setError("Microphone access was blocked. Allow the microphone in your browser settings and try again.");
      } else if (name === "NotFoundError") {
        setState("unsupported");
        setError("No microphone was found on this device.");
      } else {
        setState("idle");
        setError(err instanceof Error ? err.message : "Could not start recording");
      }
    }
  }, [cleanupStream]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const discard = useCallback(() => {
    setTake((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setState("idle");
    setElapsedMs(0);
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { state, take, elapsedMs, error, analyser: analyserRef, start, stop, discard };
}
