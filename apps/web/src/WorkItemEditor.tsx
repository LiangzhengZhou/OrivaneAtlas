import type { ProjectCategory, UpdateWorkInput } from "@arclattice/application";
import type { WorkEdge, WorkItem } from "@arclattice/domain";
import { ProjectEditor } from "./ProjectEditor";
import { TaskEditor } from "./TaskEditor";
export interface WorkEditorProps {
  item: WorkItem | null;
  projects: WorkItem[];
  categories?: readonly ProjectCategory[];
  items?: WorkItem[];
  edges?: readonly WorkEdge[];
  today?: string;
  createType: "TASK" | "PROJECT" | "MILESTONE";
  initialProjectId?: string;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSave(
    input: UpdateWorkInput & { title: string; reopenProjectVersion?: number },
  ): Promise<void>;
  onDelete: (() => Promise<void>) | null;
}
export function WorkItemEditor(props: WorkEditorProps) {
  return (props.item?.type ?? props.createType) === "PROJECT" ? (
    <ProjectEditor {...props} />
  ) : (
    <TaskEditor {...props} />
  );
}
