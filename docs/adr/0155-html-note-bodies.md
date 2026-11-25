# ADR 0155 · HTML note bodies and direct import

HTML is an explicit authoring format in the personal note editor. An imported UTF-8 document retains its source. The existing bodyMd, revision, draft, backup, compare-and-swap and sync contracts carry a versioned marker followed by a Markdown code fence. The fence is longer than any tilde run in the source, so older readers can display the source as code. Ordinary HTML tags and ordinary fenced examples in historical Markdown remain Markdown. Exporting an HTML source file removes only this envelope.

The reader shows a static HTML document in a sandboxed frame. Its content policy denies remote resources, scripts, forms, frames and document base overrides. An inert HTML template supplies an allowlisted set of elements and attributes. Source editing and source export retain the original text independently of the reading projection. Import accepts a single UTF-8 HTML/HTM file under the existing editor body and file limits. The notes list creates a new note via the normal application save; the editor asks before replacing existing content.

This approach gives users an editable, portable original with no schema migration or server upgrade dependency. Older clients lack the dedicated preview. Verify import, source edit, revision persistence, reload, safe preview, source export and ordinary Markdown via the real note entry points.
