# Service Health & Startup Reference

Used by: the UI QA agent, gsd-phase-coordinator (ui-qa loop)

## Core Protocol

Before launching any service, health-check first. Only launch if down. Wait for ready signal. Verify. If still failing after launch, investigate before escalating.

**Never blindly re-launch a service that might already be running.** A running service that receives a second launch command may crash, fork a duplicate process on a different port, or lose in-flight state.

## Health-Check-First Pattern

```bash
# Step 1: health check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" {health_check_url})

if [ "$HTTP_CODE" = "200" ]; then
  echo "Service already running — skipping launch"
else
  # Step 2: launch
  {launch_command} &
  LAUNCH_PID=$!

  # Step 3: wait for ready signal (max 60s)
  timeout 60 bash -c 'until curl -s -o /dev/null -w "%{http_code}" {health_check_url} | grep -q "200"; do sleep 2; done'

  # Step 4: verify
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" {health_check_url})
  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: Service failed to start. Check logs."
    exit 1
  fi
fi
```

## Service Config: Profile First

The service URL, health check and launch command come from the stack profile:
`stack.services[]`, one `{name, url, health?, health_cmd?, launch?, ready?}` entry per service. `health` is a
URL or path, probed with curl; `health_cmd` is the shell command (prints the HTTP status) and is evaluated only
when set. Read it with
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" profile get stack.services`.

Only when the profile has no `stack.services` does the CLAUDE.md section below apply (fallback).
When neither exists, stop and report `stack.services is not set`. No URL, health check or launch
command is assumed.

`gsd-tools service-health <start|status> <name>` uses the same order: `stack.services` first, then `dev_servers` in
config.json. It assumes no port: an entry with neither a health URL nor a port reports `no_health_url`.

## CLAUDE.md Config Format (fallback)

Projects declare their dev server config in `## QA / Dev Server` section of CLAUDE.md:

```markdown
## QA / Dev Server

### Web App
- **URL**: `stack.services[].url`
- **Health check**: `curl -s -o /dev/null -w "%{http_code}" <stack.services[].url>`
- **Launch**: the start command of the service in `stack.services[]` (from the repo root)
- **Ready signal**: "Ready in" in stdout
- **Credentials**: admin@test.local / admin123456

### Database service (if applicable)
- **Health check**: the status command of that service in `stack.services[]`
- **Launch**: the start command of that service in `stack.services[]` (from the repo root)
```

## Parsing the CLAUDE.md Config

```bash
# Read CLAUDE.md and extract QA Dev Server section
QA_CONFIG=$(awk '/^## QA \/ Dev Server/,/^## /' CLAUDE.md | grep -v "^## ")

# Extract fields
QA_URL=$(echo "$QA_CONFIG" | grep "^\- \*\*URL\*\*" | sed 's/.*: //')
QA_HEALTH_CMD=$(echo "$QA_CONFIG" | grep "^\- \*\*Health check\*\*" | sed 's/.*`: //' | tr -d '`')
QA_LAUNCH=$(echo "$QA_CONFIG" | grep "^\- \*\*Launch\*\*" | sed 's/.*`: //' | sed 's/ (.*//' | tr -d '`')
QA_CREDS=$(echo "$QA_CONFIG" | grep "^\- \*\*Credentials\*\*" | sed 's/.*: //')
```

## Framework-Specific Ready Signals

| Framework | Start Command | Ready Signal |
|-----------|---------------|--------------|
| Framework dev server | the dev command from the profile | "Ready in" |
| Vite | `npm run dev` | "ready in" |
| Express | `npm start` | "listening on port" |
| Django | `python manage.py runserver` | "Starting development server" |

## Restart Detection

A fix subagent signals restart needed by including `needs_restart: true` in its output summary. When the coordinator receives this signal:

1. Wait 3 seconds for the process to exit
2. Run health check — if still returning 200, the server hot-reloaded (no restart needed)
3. If health check fails, run the launch command and wait for ready signal
4. Re-verify health check returns 200 before proceeding to next QA round

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| curl returns 000 | Server not started | Run launch command |
| curl returns 200 then 502 | Server crashed after start | Check process logs, fix crash |
| Port in use | Previous process not killed | `lsof -ti:{port} | xargs kill` then relaunch |
| curl hangs | Server started but not responding | Kill and relaunch with different port |
