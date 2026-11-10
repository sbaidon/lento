---
"@lento/core": minor
---

Trust is now derived from signals (`start + earned + vouched - reported`) instead of blended over time. A vouch is worth only the standing others gave the voucher, tracing back to genesis accounts set with `ProtocolService.grantGenesis`. `TrustEngine.computeFromSignals` and `reconcile` are replaced by `compute` and `credibility`.
