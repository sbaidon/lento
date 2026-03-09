# Contributing

## Prerequisites

- Bun `>= 1.3`

## Setup

```bash
bun install
```

## Common Tasks

```bash
# Run all tests
bun run test

# Type-check all packages
bun run typecheck

# Lint and format
bun run lint
bun run lint:check
bun run format:check

# Full CI-equivalent local check
bun run ci
```

## Package Boundaries

- `@lento/core` contains protocol logic and reusable client/types.
- `@lento/server` should stay transport-focused and depend on `@lento/core`.
- `@lento/cli` should consume `@lento/core` contracts; avoid duplicating domain logic.

Reference:

- `docs/architecture.md`
- `docs/adr/README.md`
- `docs/releasing.md`

## Pull Request Expectations

- Include tests for behavior changes.
- Keep public API changes in `@lento/core` explicit and documented in the PR.
- Run `bun run ci` before submitting.
- Add a changeset (`bun run changeset`) for user-facing changes.
- Use a conventional PR title, e.g. `feat(cli): add new command`.

## Release Process

We use Changesets for release notes and versioning:

```bash
# Create a changeset for your user-facing change
bun run changeset

# Apply pending changesets (usually done in release PR flow)
bun run version-packages
```
