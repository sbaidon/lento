---
"@lento/core": minor
---

Abuse reports count once per reporter per target and weigh by the reporter's trust. A repeat report is rejected with `409 duplicate_report`, and reporting yourself with `400 invalid_report`.
