---
"@lento/core": minor
---

`ProtocolService` accepts an injectable id generator and `getFeed` accepts a clock, so runs can be replayed exactly. `InMemoryStore` transactions now roll back on failure, matching SQLite.
