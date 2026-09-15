import { Upload } from "lucide-react";
import { useId } from "react";

export function FilePicker({
  label,
  hint,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  hint: string;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const id = useId();
  return (
    <label className="file-picker" aria-disabled={disabled || undefined}>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        aria-describedby={id}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <span className="file-picker-icon">
        <Upload size={20} aria-hidden="true" />
      </span>
      <span className="file-picker-copy">
        <strong>{label}</strong>
        <small id={id}>{hint}</small>
      </span>
      <span aria-hidden="true" className="file-picker-plus">
        +
      </span>
    </label>
  );
}
