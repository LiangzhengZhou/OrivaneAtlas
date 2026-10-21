# 0079 — Receipt-first local recovery through the private transport

Status: implementation in progress, 2026-10-13.

Application owns recovery of complete attempted Work command groups. It queries
the original command/device receipt before any resend or rebase. Missing receipts
and transport failures retain the original SENDING group, IDs and attempt metadata.
Accepted canonical values are prepared against current pending edits and committed
by the strict replica port. Recovery neither advances cursor nor creates a user
mutation. Unsupported, partial or unconfirmed legacy groups remain unresolved.

Bootstrap supplies its existing private Cookie/native UTF-8 transport and pins
server generation, origin, workspace and authenticated principal before and after
IO and JSON parsing. Logging in alone does not enable sync or merge local data.
An explicitly confirmed durable binding is required. Logout during lookup refuses
the response without acknowledging local data. SQLite receipt reads additionally
revalidate the session inside the authenticated request transaction.

This recovery capability is not the completed reconnect coordinator. The explicit
binding surface, pull/rebase/push loop, epoch recovery and other command families
remain under their own FINAL acceptance gates.
