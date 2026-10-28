import { Maximize, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Surfaces";
import "./image-viewer.css";

type Point = { x: number; y: number };
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose(): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState(1);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const zoom = useCallback(
    (factor: number, from: Point = { x: 0, y: 0 }, to = from) => {
      setView((old) => {
        const scale = Math.max(
          Math.min(fit, 0.05),
          Math.min(8, old.scale * factor),
        );
        const ratio = scale / old.scale;
        return {
          scale,
          x: to.x - (from.x - old.x) * ratio,
          y: to.y - (from.y - old.y) * ratio,
        };
      });
    },
    [fit],
  );
  const point = (x: number, y: number): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: x - rect.left - rect.width / 2,
      y: y - rect.top - rect.height / 2,
    };
  };
  useEffect(() => {
    const node = viewport.current!;
    if (!size.width || !size.height) return;
    const resize = () => {
      const scale = Math.min(
        node.clientWidth / size.width,
        node.clientHeight / size.height,
        1,
      );
      setFit(scale);
      setView({ x: 0, y: 0, scale });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    const node = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [zoom]);
  return (
    <Dialog
      className="ui-dialog image-viewer"
      aria-label={alt || (zh ? "图片" : "Image")}
      onRequestClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoom(1.25);
        }
        if (event.key === "-") {
          event.preventDefault();
          zoom(0.8);
        }
        if (event.key === "0") {
          event.preventDefault();
          setView({ x: 0, y: 0, scale: fit });
        }
      }}
    >
      <div className="image-viewer-toolbar">
        <span className="image-viewer-name">
          {alt || (zh ? "图片" : "Image")}
        </span>
        <IconButton label={zh ? "缩小" : "Zoom out"} onClick={() => zoom(0.8)}>
          <Minus />
        </IconButton>
        <output aria-label={zh ? "缩放比例" : "Zoom level"}>
          {Math.round(view.scale * 100)}%
        </output>
        <IconButton label={zh ? "放大" : "Zoom in"} onClick={() => zoom(1.25)}>
          <Plus />
        </IconButton>
        <IconButton
          label={zh ? "适应窗口" : "Fit to window"}
          onClick={() => setView({ x: 0, y: 0, scale: fit })}
        >
          <Maximize />
        </IconButton>
        <IconButton
          label={zh ? "原始尺寸" : "Actual size"}
          onClick={() => setView({ x: 0, y: 0, scale: 1 })}
        >
          <span aria-hidden="true">1:1</span>
        </IconButton>
        <IconButton label={zh ? "关闭" : "Close"} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div
        className="image-viewer-viewport"
        ref={viewport}
        onDoubleClick={() =>
          setView({
            x: 0,
            y: 0,
            scale: view.scale === fit ? Math.max(1, fit * 2) : fit,
          })
        }
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(
            event.pointerId,
            point(event.clientX, event.clientY),
          );
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          const before = [...pointers.current.values()];
          const previous = pointers.current.get(event.pointerId)!;
          const next = point(event.clientX, event.clientY);
          pointers.current.set(event.pointerId, next);
          const after = [...pointers.current.values()];
          if (before.length === 2) {
            const length = distance(before[0]!, before[1]!);
            if (length > 0)
              zoom(
                distance(after[0]!, after[1]!) / length,
                midpoint(before[0]!, before[1]!),
                midpoint(after[0]!, after[1]!),
              );
          } else if (before.length === 1) {
            setView((old) => ({
              ...old,
              x: old.x + next.x - previous.x,
              y: old.y + next.y - previous.y,
            }));
          }
        }}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) =>
          pointers.current.delete(event.pointerId)
        }
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={{
            width: size.width || undefined,
            height: size.height || undefined,
            transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
          }}
        />
      </div>
    </Dialog>
  );
}
