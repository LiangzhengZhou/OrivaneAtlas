import { projectKnowledgeScope } from "./project-knowledge-scope";

/** Does not receive provider/model/profile identifiers. */
export class RetrievalContextResolver {
  resolve(input: Parameters<typeof projectKnowledgeScope>[0]) {
    return projectKnowledgeScope(input);
  }
}
