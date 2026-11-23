import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";

type UploadState = "waiting" | "writing" | "done" | "failed" | "cancelled";
interface Entry {
  id: string;
  name: string;
  file?: File;
  state: UploadState;
}

export function ResourceUploadQueue({
  zh,
  busy,
  onUpload,
}: {
  zh: boolean;
  busy: boolean;
  onUpload(file: File, openAfter: boolean): Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const entries = useRef<Entry[]>([]);
  const running = useRef(false);
  const mounted = useRef(false);
  const [jobs, setJobs] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function publish() {
    setJobs([...entries.current]);
  }
  async function process(openSingle: boolean) {
    if (running.current) return;
    running.current = true;
    try {
      while (mounted.current) {
        const job = entries.current.find((entry) => entry.state === "waiting");
        if (!job?.file) break;
        job.state = "writing";
        publish();
        try {
          job.state = (await onUpload(
            job.file,
            openSingle && entries.current.length === 1,
          ))
            ? "done"
            : "failed";
        } catch {
          job.state = "failed";
        }
        if (job.state === "done") delete job.file;
        if (mounted.current) publish();
      }
    } finally {
      running.current = false;
    }
  }
  function enqueue(files: FileList | null) {
    if (!files?.length) return;
    entries.current = [
      ...entries.current.filter(
        (job) => job.state !== "done" && job.state !== "cancelled",
      ),
      ...Array.from(files, (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        state: "waiting" as const,
      })),
    ];
    publish();
    void process(files.length === 1);
  }
  const labels = zh
    ? {
        waiting: "等待上传",
        writing: "正在保存",
        done: "已保存",
        failed: "上传失败",
        cancelled: "已取消",
      }
    : {
        waiting: "Queued",
        writing: "Saving",
        done: "Saved",
        failed: "Upload failed",
        cancelled: "Cancelled",
      };
  return (
    <div
      className="files-upload-queue"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(false);
        enqueue(event.dataTransfer.files);
      }}
    >
      <Button
        type="button"
        variant="secondary"
        disabled={busy && !running.current}
        aria-label={zh ? "上传文件" : "Upload file"}
        onClick={() => input.current?.click()}
      >
        <Upload size={16} />
        {zh ? "上传" : "Upload"}
      </Button>
      <input
        hidden
        multiple
        type="file"
        ref={input}
        onChange={(event) => {
          enqueue(event.target.files);
          event.target.value = "";
        }}
      />
      {jobs.length > 0 && (
        <section
          className="files-upload-status"
          aria-label={zh ? "上传队列" : "Upload queue"}
        >
          <p role="status">
            {zh ? "已保存" : "Saved"}{" "}
            {jobs.filter((job) => job.state === "done").length} / {jobs.length}
          </p>
          {jobs.some((job) => job.state === "waiting") && (
            <p>
              {zh
                ? "离开资源页会取消等待中的文件。"
                : "Leaving Files cancels queued files."}
            </p>
          )}
          <ul>
            {jobs.map((job) => (
              <li key={job.id}>
                <span>{job.name}</span>
                <small>{labels[job.state]}</small>
                {job.state === "waiting" && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      job.state = "cancelled";
                      delete job.file;
                      publish();
                    }}
                  >
                    {zh ? "取消" : "Cancel"}
                  </Button>
                )}
                {job.state === "failed" && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      job.state = "waiting";
                      publish();
                      void process(false);
                    }}
                  >
                    {zh ? "重试" : "Retry"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!jobs.some(
            (job) => job.state === "waiting" || job.state === "writing",
          ) && (
            <Button
              variant="ghost"
              onClick={() => {
                entries.current = [];
                publish();
              }}
            >
              {zh ? "关闭队列" : "Dismiss queue"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
