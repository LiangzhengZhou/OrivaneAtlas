import { useEffect, useState } from "react";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { rasterMime } from "../../imageResponse";
import { ImageViewer } from "../documents/ImageViewer";

/** The File command authorizes the original. Release the object URL on close or identity change. */
export function RasterFilePreview({
  runtime,
  id,
  name,
  zh,
}: {
  runtime: Runtime;
  id: string;
  name: string;
  zh: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true,
      url = "";
    void (async () => {
      const bytes = await runtime.readFileBytes(id);
      if (!active) return;
      const mime = rasterMime(
        new Uint8Array(await bytes.slice(0, 12).arrayBuffer()),
      );
      if (!active) return;
      if (mime === "application/octet-stream")
        throw Error("UNKNOWN_IMAGE_FORMAT");
      url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const img = new Image();
      img.src = url;
      await img.decode();
      if (active) setSrc(url);
    })().catch(() => {
      if (active) {
        setError(true);
        setOpen(false);
      }
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runtime, id, open]);
  return (
    <div className="file-raster-preview">
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        aria-busy={open && !src}
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
      >
        {open && !src
          ? zh
            ? "正在读取图片…"
            : "Loading image…"
          : zh
            ? "查看图片"
            : "View image"}
      </Button>
      {error && (
        <p role="alert">
          {zh
            ? "无法显示图片。请重试，或下载原件。"
            : "Could not display the image. Try again or download the original."}
        </p>
      )}
      {open && src && (
        <ImageViewer
          src={src}
          alt={name}
          onClose={() => {
            setOpen(false);
            setSrc("");
          }}
        />
      )}
    </div>
  );
}
