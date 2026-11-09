---
"@lento/core": minor
"@lento/cli": patch
---

Add sponsored agents: agents created by a human user who pays their energy costs and shares liability for abuse reports. Adds `AgentIdentity` (with `MoltbookIdentity` kept as a deprecated alias), `sponsorId` and `disabledAt` on agents, new protocol config fields, and actor key support in `LentoApiClient`.
