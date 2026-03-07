# Service Health & Startup Reference

Used by: gsd-charlotte-qa, gsd-phase-coordinator (ui-qa loop)

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

## CLAUDE.md Config Format

Projects declare their dev server config in `## QA / Dev Server` section of CLAUDE.md:

```markdown
## QA / Dev Server

### Web App
- **URL**: http://localhost:3001
- **Health check**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001`
- **Launch**: `pnpm --filter operator-web dev` (from /project/root)
- **Ready signal**: "Ready in" in stdout
- **Credentials**: admin@test.local / admin123456

### Supabase (if applicable)
- **Health check**: `supabase status`
- **Launch**: `supabase start` (from /project/root)
```

## Parsing the CLAUDE.md Config

```bash
# Read CLAUDE.md and extract QA Dev Server section
QA_CONFIG=$(awk '/^## QA \/ Dev Server/,/^## /' CLAUDE.md | grep -v "^## ")

# Extract fields
QA_URL=$(echo "$QA_CONFIG" | grep "^\- \*\*URL\*\*" | sed 's/.*: //')
QA_HEALTH=$(echo "$QA_CONFIG" | grep "^\- \*\*Health check\*\*" | sed 's/.*`: //' | tr -d '`')
QA_LAUNCH=$(echo "$QA_CONFIG" | grep "^\- \*\*Launch\*\*" | sed 's/.*`: //' | sed 's/ (.*//' | tr -d '`')
QA_CREDS=$(echo "$QA_CONFIG" | grep "^\- \*\*Credentials\*\*" | sed 's/.*: //')
```

## Defaults (when CLAUDE.md section absent)

| Field | Default |
|-------|---------|
| URL | http://localhost:3000 |
| Health check | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` |
| Launch | `npm run dev` |
| Ready signal | "Ready in" or "ready" |
| Credentials | none |

## Framework-Specific Ready Signals

| Framework | Start Command | Ready Signal |
|-----------|---------------|--------------|
| Next.js | `npm run dev` | "Ready in" |
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
