import type { WorkItem } from "@arclattice/domain";

export function ProjectStructureTree({
  projects,
  parentId,
  onOpen,
}: {
  projects: readonly WorkItem[];
  parentId: string | null;
  onOpen(id: string): void;
}) {
  const children = projects.filter(
    (project) =>
      project.type === "PROJECT" &&
      !project.deletedAt &&
      project.parentProjectId === parentId,
  );
  return (
    <ul>
      {children.map((project) => (
        <li key={project.id}>
          <button
            className="text-button"
            type="button"
            onClick={() => onOpen(project.id)}
          >
            {project.title}
          </button>
          <ProjectStructureTree
            projects={projects.filter((entry) => entry.id !== project.id)}
            parentId={project.id}
            onOpen={onOpen}
          />
        </li>
      ))}
    </ul>
  );
}
