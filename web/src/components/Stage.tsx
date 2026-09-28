"use client";

import { useRef, useState, type PointerEvent } from "react";

import { displayToNormalized, rectFromPoints, type NormRect, type Point, type Size } from "@/lib/geometry";
import { regionTitle, type Region } from "@/lib/regions";

/** Drags smaller than this (in display pixels) are treated as clicks. */
const MIN_DRAG_PX = 6;

type Props = {
  src: string;
  alt: string;
  heatmapUrl: string | null;
  showHeatmap: boolean;
  opacity: number;
  regions: Region[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: NormRect) => void;
  onImageSize: (size: Size) => void;
};

export function Stage(props: Props) {
  const { regions, selectedId } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ start: Point; current: Point; startClient: Point } | null>(null);

  const toNormalized = (event: PointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    return displayToNormalized(event.clientX, event.clientY, box);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; drawing still works while the pointer stays over the image.
    }
    const p = toNormalized(event);
    setDrag({ start: p, current: p, startClient: { x: event.clientX, y: event.clientY } });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag) setDrag({ ...drag, current: toNormalized(event) });
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const end = toNormalized(event);
    const moved = Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y);
    setDrag(null);
    if (moved >= MIN_DRAG_PX) {
      const rect = rectFromPoints(drag.start, end);
      if (rect.width > 0 && rect.height > 0) props.onCreate(rect);
      return;
    }
    // A click selects the smallest region under the pointer (or clears the selection).
    const hit = regions
      .filter((r) => end.x >= r.rect.x && end.x <= r.rect.x + r.rect.width && end.y >= r.rect.y && end.y <= r.rect.y + r.rect.height)
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    props.onSelect(hit ? hit.id : null);
  };

  const preview = drag ? rectFromPoints(drag.start, drag.current) : null;

  return (
    <div className="stage">
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      <img
        className="stage__image"
        src={props.src}
        alt={props.alt}
        draggable={false}
        onLoad={(e) => props.onImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      />
      {props.heatmapUrl && props.showHeatmap && (
        // eslint-disable-next-line @next/next/no-img-element -- API-generated data URL
        <img className="stage__heatmap" src={props.heatmapUrl} alt="" aria-hidden="true" style={{ opacity: props.opacity }} />
      )}
      <svg
        ref={svgRef}
        className="stage__overlay"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        role="group"
        aria-label={`${props.alt}. Drag to draw a region; keyboard users can use Add region and the coordinate fields.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {regions.map((r) => (
          <rect
            key={r.id}
            className={`region region--${r.label}${r.id === selectedId ? " region--selected" : ""}`}
            x={r.rect.x}
            y={r.rect.y}
            width={r.rect.width}
            height={r.rect.height}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {preview && (
          <rect
            className="region region--preview"
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {regions.map((r) => (
        <span
          key={r.id}
          className={`region-tag region-tag--${r.label}`}
          style={{ left: `${r.rect.x * 100}%`, top: `${r.rect.y * 100}%` }}
          aria-hidden="true"
        >
          {regionTitle(r)}
        </span>
      ))}
    </div>
  );
}
