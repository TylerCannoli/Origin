"use client";
import { useEffect, useRef } from "react";

/** Native <dialog>-based modal with backdrop close and Escape handling. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(92vw,34rem)] rounded-lg border border-line bg-surface p-0 text-ink"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-2xl">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
