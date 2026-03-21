# DyoBot

## Running DyoBot

Always start dyobot with log capture so logs can be inspected:

```bash
node dist/index.js > /tmp/dyobot.log 2>&1 &disown
```

After starting, check logs with:
```bash
tail -f /tmp/dyobot.log                    # live follow
grep -E "task proposed|Execution result|task evaluated" /tmp/dyobot.log  # voyager activity
```

Before restarting, always kill existing instances first:
```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; sleep 2
```

## Building

```bash
npm run build   # runs tsc
```

## Spawning Bots

```bash
curl -s -X POST http://127.0.0.1:3001/api/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"BotName","personality":"farmer","mode":"codegen"}'
```

Available personalities: merchant, guard, explorer, farmer, blacksmith, elder

## Checking Status

```bash
curl -s http://127.0.0.1:3001/api/bots
```
