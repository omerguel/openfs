/* ------------------------------------------------------------------ */
/* Print preview that keeps the page layout: the document renders at   */
/* its print width and is scaled down to fit narrow screens instead of */
/* being clipped or reflowed into a tall column.                       */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ScaledPreview({
  width = 760,
  className,
  children,
}: {
  /** Layout width of the document in CSS pixels (≈ A4 at 96 dpi). */
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = outer.current;
    if (!element) return;
    const update = () => setScale(Math.min(1, element.clientWidth / width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={outer} className={className}>
      <div style={{ width, zoom: scale }}>{children}</div>
    </div>
  );
}
