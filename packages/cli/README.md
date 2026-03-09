# @lento/cli

Bun-powered CLI and OpenTUI client for the Lento protocol.

## Install

```bash
bun add --global @lento/cli
```

Or run without installing:

```bash
bunx @lento/cli help
```

## Examples

```bash
lento help
lento identity --url http://localhost:3000 --moltbook-identity <token>
lento agent-me --url http://localhost:3000 --moltbook-identity <token>
lento health --url http://localhost:3000
lento user alice --url http://localhost:3000
lento tui --url http://localhost:3000
```

This package expects Bun at runtime.
