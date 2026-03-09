# ADR 0002: Bun as Runtime and Toolchain

- Status: Accepted
- Date: 2026-02-26

## Context

This repository needs a fast, unified developer loop for package install, runtime execution, testing, and script orchestration. Mixed tooling increases setup complexity and CI divergence.

## Decision

Standardize on Bun across the monorepo:

- Runtime for server and CLI
- Workspace/package manager
- Test runner
- Script executor

Pin Bun version with `.bun-version` and `packageManager` metadata in root `package.json`.

## Consequences

Positive:

- Consistent local and CI behavior.
- Faster install/test workflows.
- Fewer toolchain compatibility layers.

Negative:

- Team contributors need Bun installed.
- Some ecosystem tools may require Bun-specific invocation patterns.
