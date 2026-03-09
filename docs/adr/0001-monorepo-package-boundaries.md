# ADR 0001: Monorepo Package Boundaries

- Status: Accepted
- Date: 2026-02-26

## Context

The project contains shared protocol logic plus multiple delivery surfaces (HTTP server and CLI/TUI). Without clear package boundaries, business rules risk being duplicated and drifting between clients and server.

## Decision

Adopt a Bun workspace monorepo with explicit package roles:

- `@lento/core`: domain logic and shared contracts
- `@lento/server`: HTTP transport only
- `@lento/cli`: command and TUI user interfaces

Enforce one-way dependencies: server/cli may depend on core, core must not depend on server/cli.

## Consequences

Positive:

- Protocol behavior stays consistent across interfaces.
- Easier code ownership and onboarding.
- Better testability through isolated package scopes.

Negative:

- More workspace configuration overhead.
- Cross-package refactors require coordinated changes.
