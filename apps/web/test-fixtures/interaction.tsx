import { createI18n, resolveLocale } from "@arclattice/i18n";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Button } from "../src/components/ui/Button";
import { ComboboxPicker } from "../src/components/ui/ComboboxPicker";
import { NavigationRow, SelectableRow } from "../src/components/ui/Content";
import { EntityPickerRow } from "../src/components/ui/EntityPickerRow";
import { InlineStateConfirm } from "../src/components/ui/InlineStateConfirm";
import { EditorShell } from "../src/components/ui/InteractionSurfaces";
import { PrioritySignal } from "../src/components/ui/PrioritySignal";
import {
  DragHandle,
  SortableList,
  SortableRow,
  useLongPressDrag,
} from "../src/components/ui/Sortable";
import { TouchReorderScope } from "../src/components/ui/TouchReorder";
import { VirtualTaskCollection } from "../src/features/tasks/VirtualTaskCollection";
import "../src/styles/tokens.css";
import "../src/styles/themes.css";
import "../src/components/ui/controls.css";

function Fixture() {
  const [events, setEvents] = useState<string[]>([]);
  const [selected, setSelected] = useState(false);
  const [choice, setChoice] = useState("alpha");
  const [editing, setEditing] = useState(false);
  const [showTouchSource, setShowTouchSource] = useState(true);
  const [virtualVisible, setVirtualVisible] = useState(false);
  const record = (value: string) => setEvents((current) => [...current, value]);
  const touch = useLongPressDrag(() => record("long-press"));
  return (
    <main>
      <section
        aria-label="Priority signals"
        style={{ background: "var(--surface)" }}
      >
        {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((priority) => (
          <PrioritySignal key={priority} priority={priority} label={priority} />
        ))}
      </section>
      <SortableList aria-label="Touch reorder fixture">
        {["A", "B", "C"]
          .filter((id) => id !== "A" || showTouchSource)
          .map((id) => (
            <SortableRow
              key={id}
              entityId={id}
              scopeKey="fixture:tasks"
              disabled={id === "C"}
              onMoveBefore={(movingId, targetId) =>
                record(`touch-move:${movingId}:${targetId}`)
              }
              onMoveAfter={(movingId, targetId) =>
                record(`touch-after:${movingId}:${targetId}`)
              }
            >
              <span style={{ display: "block", height: 72 }}>
                Touch row {id}
              </span>
            </SortableRow>
          ))}
      </SortableList>
      <Button onClick={() => setShowTouchSource(false)}>
        Unmount virtual source
      </Button>
      <Button onClick={() => setVirtualVisible(true)}>
        Show virtual reorder fixture
      </Button>
      {virtualVisible && (
        <TouchReorderScope>
          <section className="touch-virtual-fixture">
            <style>
              {
                ".touch-virtual-fixture .virtual-task-scroll {height:240px;overflow:auto;}"
              }
            </style>
            <VirtualTaskCollection
              items={Array.from({ length: 1500 }, (_, index) => ({
                id: `virtual-${index}`,
              }))}
              estimatedRowHeight={72}
              render={(item) => (
                <SortableRow
                  entityId={item.id}
                  scopeKey="fixture:virtual"
                  onMoveBefore={(movingId, targetId) =>
                    record(`virtual-move:${movingId}:${targetId}`)
                  }
                  onMoveAfter={(movingId, targetId) =>
                    record(`virtual-after:${movingId}:${targetId}`)
                  }
                >
                  <span style={{ display: "block", height: 72 }}>
                    {item.id}
                  </span>
                </SortableRow>
              )}
            />
          </section>
        </TouchReorderScope>
      )}
      <NavigationRow onOpen={() => record("navigate")}>
        Destination
        <button type="button" onClick={() => record("nested")}>
          Nested action
        </button>
      </NavigationRow>
      <SelectableRow
        onSelect={() => record("select")}
        onOpen={() => record("open")}
      >
        Operational row
      </SelectableRow>
      <InlineStateConfirm
        entityId="task-a"
        intent="COMPLETE"
        label="Complete"
        confirmLabel="Confirm completion"
        onConfirm={() => record("commit")}
      >
        ○
      </InlineStateConfirm>
      <button type="button">Outside</button>
      <ul>
        <EntityPickerRow
          title="Parent project"
          selected={selected}
          exploreLabel="Explore child projects"
          onSelect={() => {
            setSelected(!selected);
            record("picker-select");
          }}
          onExplore={() => record("explore")}
        />
      </ul>
      <DragHandle
        input={{
          version: 1,
          intent: "REORDER",
          entityId: "a",
          scopeKey: "project:p",
        }}
        label="Move row (Alt+Up/Down)"
        onMove={(direction) => record(direction)}
      />
      <div {...touch} data-testid="touch-row" style={{ padding: 24 }}>
        Touch row
      </div>
      <output aria-label="Events">{events.join(",")}</output>
      <ComboboxPicker
        label="Choose property"
        value={choice}
        options={[
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
          { value: "disabled", label: "Disabled choice", disabled: true },
        ]}
        onChange={(value) => {
          setChoice(value);
          record(value);
        }}
      />
      <Button onClick={() => setEditing(true)}>Open editor</Button>
      {editing && (
        <EditorShell
          title="Shared editor"
          onClose={() => setEditing(false)}
          footer={
            <>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  record("save");
                  setEditing(false);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <label>
            Title
            <input />
          </label>
          <div style={{ height: 1200 }}>Scrollable body</div>
        </EditorShell>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
async function start() {
  const i18n = await createI18n(resolveLocale(null, navigator.language));
  createRoot(root!).render(
    <I18nextProvider i18n={i18n}>
      <Fixture />
    </I18nextProvider>,
  );
}
void start();
