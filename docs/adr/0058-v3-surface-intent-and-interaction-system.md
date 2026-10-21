# ADR 0058 — v3 surface intent and application interaction system

Accepted 2026-10-11 for the local v3 implementation candidate.

Navigation, operational selection and analytical inspection are separate intents.
Project, Space, Document and File navigation rows open on click or keyboard
activation. Operational and graph rows select on click and open on Enter or
double click. Selection does not grant access, invoke Atlas, or imply that an
Inspector must mount. Nested actions retain their own event semantics.

Shared editor surfaces own a single scrolling body, stable footer and a modal
focus boundary. Quick and full editors use this structure with different content;
feature styles own layout rather than independently redefining controls.
Settings use sectioned rows and detail surfaces. Hierarchy pickers select through
the row body; only the chevron drills down. A selected marker is not a second
select action.

Inline completion and restore use an ephemeral four-second arm. The first click
does not invoke a business callback. Escape, outside interaction, entity/intent
change and expiry cancel the arm. The second click invokes the existing
Application mutation. This UI timer is unrelated to native notification delivery.

Business validation, permissions, versions and transactional persistence remain
in Domain/Application. These primitives do not represent completed feature
migration or v3 acceptance. Release metadata remains 2.4.0 until separately
authorized release preparation; this ADR authorizes no publication or deployment.
