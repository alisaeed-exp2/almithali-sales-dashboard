"use client";
import { useCallback, useState, type ReactNode, type MouseEvent } from "react";

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

/** Shared hover tooltip: follows the pointer, flips near the right edge. */
export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((e: MouseEvent, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const hide = useCallback(() => setTip(null), []);
  const flip = typeof window !== "undefined" && tip ? tip.x > window.innerWidth - 260 : false;
  const node = tip ? (
    <div
      className="tooltip"
      role="tooltip"
      style={{ left: flip ? tip.x - 14 : tip.x + 14, top: tip.y + 14, transform: flip ? "translateX(-100%)" : undefined }}
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

export function TipRows({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <>
      <div className="tooltip-title">{title}</div>
      {rows.map(([k, v]) => (
        <div className="tooltip-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </>
  );
}
