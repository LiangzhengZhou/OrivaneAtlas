import {
  type EntityRef,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { knowledgeForceLayout } from "../graph/layouts/KnowledgeForceLayout";

export function KnowledgeGraph({
  snapshot,
  onOpen,
  documentId,
  projectId,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  documentId?: string;
  projectId?: string;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [scope, setScope] = useState("local");
  const [hops, setHops] = useState(1);
  const [query, setQuery] = useState("");
  const documents = scopedKnowledgeDocuments({
    ...snapshot,
    projectId,
    currentSpaceId:
      snapshot.library.find((entry) => entry.id === documentId)?.spaceId ??
      undefined,
    workspaceFallback: true,
  });
  const focus =
    documents.find(
      (entry) =>
        query &&
        entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ??
    documents.find((entry) => entry.id === documentId) ??
    documents[0];
  const links = snapshot.wikiLinks ?? [];
  const connected = new Set(
    links.flatMap((link) =>
      link.targetDocumentId
        ? [link.sourceDocumentId, link.targetDocumentId]
        : [],
    ),
  );
  const neighbors = new Set(focus ? [focus.id] : []);
  for (let hop = 0; hop < hops; hop++) {
    const frontier = new Set(neighbors);
    for (const link of links) {
      if (
        link.targetDocumentId &&
        (frontier.has(link.sourceDocumentId) ||
          frontier.has(link.targetDocumentId))
      ) {
        neighbors.add(link.sourceDocumentId);
        neighbors.add(link.targetDocumentId);
      }
    }
  }
  const visible = documents.filter(
    (entry) =>
      connected.has(entry.id) &&
      (scope === "workspace" || scope === "space"
        ? scope === "workspace" || entry.spaceId === focus?.spaceId
        : neighbors.has(entry.id)),
  );
  const ids = new Set(visible.map((entry) => entry.id));
  const edges = links
    .filter(
      (link) =>
        link.targetDocumentId &&
        ids.has(link.sourceDocumentId) &&
        ids.has(link.targetDocumentId),
    )
    .map((link, index) => ({
      id: String(index),
      source: link.sourceDocumentId,
      target: link.targetDocumentId!,
    }));
  const positions = knowledgeForceLayout([...ids], edges);
  const nodes = visible.map((entry) => ({
    id: entry.id,
    data: { label: entry.title },
    position: positions.find((position) => position.id === entry.id)!.position,
    style: { opacity: query && !neighbors.has(entry.id) ? 0.25 : 1 },
  }));
  return (
    <section className="graph-section">
      <div className="action-row">
        <input
          aria-label={zh ? "图谱搜索" : "Graph search"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {(["local", "space", "workspace"] as const).map((value) => (
          <button
            type="button"
            className="chip"
            aria-pressed={scope === value}
            key={value}
            onClick={() => setScope(value)}
          >
            {zh
              ? { local: "局部", space: "空间", workspace: "工作区" }[value]
              : value}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => setHops(hops === 1 ? 2 : 1)}
        >
          {hops} hop
        </button>
      </div>
      <GraphViewport
        nodes={nodes}
        edges={edges}
        onOpen={(id) => onOpen({ kind: "DOCUMENT", id })}
      />
    </section>
  );
}
