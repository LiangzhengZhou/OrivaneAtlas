# Orivane Atlas documentation

This directory contains public documentation for people who want to run, understand, extend, or contribute to Orivane Atlas.

## Start here

- [Self-hosting](SELF_HOSTING.md) - run your own server and connect clients.
- [Development](DEVELOPMENT.md) - install dependencies, work on the codebase, and run checks.
- [OpenAPI](api/openapi.json) - HTTP API contract.
- [Storage](STORAGE.md) - persistence model and backup boundaries.
- [Architecture](architecture/arclattice-v0-architecture.md) - product architecture and layer boundaries.

The ADR files record public technical decisions. They are reference material, not a task queue.

## Product direction

Orivane Atlas is a self-hostable, server-backed workspace. Native clients connect to the user server and may keep local drafts, while the server remains authoritative. Optional AI providers and future local-AI collaboration can extend the workspace, but AI is not required to use the product and this repository is not a handoff or orchestration system.

## Private material

Production addresses, credentials, signing keys, databases, user data, internal deployment notes, and historical handoff records are intentionally kept outside the public repository.
