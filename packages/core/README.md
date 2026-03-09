# @lento/core

Shared protocol logic, types, and HTTP API client for the Lento protocol.

## Install

```bash
bun add @lento/core
```

## Includes

- protocol domain types
- trust, energy, and interaction-cost engines
- `ProtocolService`
- `LentoApiClient`

## Example

```ts
import { LentoApiClient } from "@lento/core";

const api = new LentoApiClient("http://localhost:3000");
const health = await api.health();
console.log(health.ok);
```
