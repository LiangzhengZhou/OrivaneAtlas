import { type ComponentProps, memo } from "react";
import { useTranslation } from "react-i18next";
import { GraphWorkspace } from "../../features/graph/GraphWorkspace";
import { useGraphRoute } from "../hooks/useGraphRoute";
import { PageHeader } from "../PageHeader";

/** Graph route/viewport changes stay within the mounted graph workspace. */
export const GraphRoute = memo(
  function GraphRoute({
    onRouteAccepted,
    active: _active,
    scopeKey: _scopeKey,
    ...props
  }: Omit<ComponentProps<typeof GraphWorkspace>, "route" | "onRouteChange"> & {
    onRouteAccepted(): void;
    active?: boolean;
    scopeKey: string;
  }) {
    const navigation = useGraphRoute();
    const { i18n } = useTranslation("desk");
    const zh = i18n.language.startsWith("zh");
    if (!navigation.route)
      return (
        <section className="graph-scope-entry">
          <PageHeader title={zh ? "图谱" : "Graphs"} />
          <div>
            <h2>{zh ? "知识关系" : "Knowledge relationships"}</h2>
            <p>
              {zh
                ? "在知识空间中选择文档，查看它的链接和邻近文档。"
                : "Choose a document in a knowledge space to explore its links and neighboring documents."}
            </p>
            <a className="ui-button ui-button-secondary" href="#library">
              {zh ? "浏览知识空间" : "Browse knowledge spaces"}
            </a>
          </div>
          <div>
            <h2>
              {zh
                ? "项目结构与任务依赖"
                : "Project structure and task dependencies"}
            </h2>
            <p>
              {zh
                ? "选择项目，查看子项目层级或任务的先后关系。"
                : "Choose a project to explore its hierarchy or the order of dependent tasks."}
            </p>
            <a className="ui-button ui-button-secondary" href="#projects">
              {zh ? "浏览项目" : "Browse projects"}
            </a>
          </div>
        </section>
      );
    return (
      <GraphWorkspace
        {...props}
        route={navigation.route}
        onRouteChange={(patch) => {
          navigation.update(patch);
          onRouteAccepted();
        }}
      />
    );
  },
  (previous, next) =>
    previous.scopeKey === next.scopeKey &&
    previous.active === false &&
    next.active === false,
);
