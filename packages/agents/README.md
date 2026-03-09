# @lento/agents

Private agent simulation harness for pressure-testing the Lento protocol.

## Usage

```bash
export LENTO_DEV_IDENTITY_MODE=true
export LENTO_REQUIRE_IDENTITY_FOR_WRITES=true

bun run start
bun run agents -- scenarios
bun run agents -- scenario starter-swarm --ticks 4 --url http://localhost:3000
bun run agents -- scenario mixed-signals --ticks 5 --url http://localhost:3000 --reset
```

Default state file: `.lento/agents/state.json`
