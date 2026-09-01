"use client";
import { useEffect, useRef, type RefObject } from "react";

/** Live input level bars drawn from an AnalyserNode; idle bars when not recording. */
export function WaveformPreview({ analyser, active }: { analyser: RefObject<AnalyserNode | null>; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const bars = 48;
    const history: number[] = new Array(bars).fill(0.04);
    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const node = analyser.current;
      let level = 0.04;
      if (node && active) {
        const data = new Uint8Array(node.fftSize);
        node.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        level = Math.min(1, Math.sqrt(sum / data.length) * 3 + 0.04);
      }
      history.push(level);
      history.shift();
      const gap = 3;
      const w = (width - gap * (bars - 1)) / bars;
      ctx.fillStyle = active ? "#d23a2e" : "#a9b2a6";
      history.forEach((h, i) => {
        const bh = Math.max(3, h * height);
        ctx.fillRect(i * (w + gap), (height - bh) / 2, w, bh);
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, active]);
  return <canvas ref={canvasRef} width={480} height={72} className="h-16 w-full" aria-hidden />;
}
