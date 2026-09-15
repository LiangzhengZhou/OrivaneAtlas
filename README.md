<p align="center">
  <img src="apps/web/public/orivane-atlas.png" alt="Orivane Atlas logo" width="320">
</p>

<h1 align="center">Orivane Atlas</h1>

<p align="center">A Markdown-first, server-backed personal workspace for tasks, notes, knowledge, and optional AI assistance.</p>

<p align="center"><a href="https://github.com/LiangzhengZhou/OrivaneAtlas/releases">Releases</a> · <a href="docs/SELF_HOSTING.md">Self-hosting</a> · <a href="docs/DEVELOPMENT.md">Development</a> · <a href="LICENSE">Apache-2.0</a></p>

## What it is

Orivane Atlas is a self-hostable workspace combining Markdown documents, notes, journals, tasks, project organization, knowledge relationships, revisions, and account-isolated server storage. Web and native clients connect to the same server; the server remains the source of truth while clients may keep local drafts.

AI integration is optional. Orivane Atlas is not a handoff-only project: this repository is for people who want to run, use, extend, or contribute to the product.

## Features

- Markdown editing with source, preview, and reading views
- Notes, journals, revisions, import, export, and recovery
- Tasks, projects, dates, calendar views, boards, and dependency graphs
- Knowledge spaces and document relationships
- Account and workspace isolation
- SQLite-backed self-hosted deployment with an HTTP API
- English and Simplified Chinese UI
- Windows and Android native clients
- Optional AI provider integration with explicit context and approval boundaries

## Quick start

See the [self-hosting guide](docs/SELF_HOSTING.md) for deployment instructions.

    pnpm install --frozen-lockfile
    pnpm build

For local development, read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The documentation index is [docs/README.md](docs/README.md).

## Downloads

Debug Windows and Android builds are published on [GitHub Releases](https://github.com/LiangzhengZhou/OrivaneAtlas/releases). The current Android package is arm64 debug, and the native builds are not formal production-signed releases.

## Security and privacy

Never commit database files, authentication material, provider credentials, encryption keys, signing keys, or production configuration. See [SECURITY.md](SECURITY.md).

## License

Orivane Atlas is released under the [Apache License 2.0](LICENSE).
