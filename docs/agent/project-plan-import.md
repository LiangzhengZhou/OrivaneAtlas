# External AI project-plan import

Orivane Atlas accepts reviewed plan proposals through the existing workflow API. An external AI must use a dedicated, revocable agent credential or personal access token; never share a primary account password. Tokens should be least-privilege, kept out of prompts, browser local storage, source code, and logs.

## Current capability

Manifest v1 supports new projects/subprojects, categories, multi-project tasks and dependencies, recurrence definitions, knowledge spaces and Markdown documents. At least one entity is required. Preview and explicit human confirmation are mandatory. Publishing is atomic/idempotent. Existing Markdown is never rewritten or converted into tasks.

All temporary IDs share a namespace. Project references use projectTempId/projectTempIds for new projects and projectId/projectIds for existing projects. Maximum ancestry depth is 16 including existing parents. Categories use name plus projectIds/projectTempIds; existingId references an existing category and requires its exact current name. Tasks accept priority, assigneePrincipalId, activationState and activationPolicy. Recurrences additionally require startDate/timezone/frequency/interval and accept inclusive endDate. Markdown fields are limited to 200000 characters and preserved exactly.

Documents require spaceTempId/spaceId or projectTempId/projectId. Project-only documents use the dedicated project space. ownership is OWNED or LINKED; OWNED requires a project. Knowledge spaces use descriptionMd as their body. Manifest array order does not control project creation order.

## Safe integration sequence

1. Obtain a scoped agent credential from the account owner.
2. Send the workspace ID, target project ID, manifest, and idempotency key over HTTPS.
3. Show the preview and validation errors to a human.
4. A signed-in human publishes only after explicit confirmation. PAT/agent credentials cannot publish. MCP plan_preview creates an EXTERNAL_AI proposal which a human in the same workspace can review; full version snapshots are revalidated, and document source remains EXTERNAL_AI.
5. Revoke or rotate the credential when the integration is no longer needed.

All mutations run in the authenticated principal's workspace transaction. A stale graph/category/library snapshot requires a new preview. Failed writes roll back work, documents, categories, definitions and events. Replaying the accepted proposal version returns the original result without duplicates. Published provenance records each entity, imported fields, confirming principal and time. Source documents are data, never execution instructions.

See docs/WORKFLOWS.md and the server OpenAPI description for the version-specific route names.
