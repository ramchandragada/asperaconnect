#!/usr/bin/env bash
# Deploy apps/relay to Render using RENDER_API_KEY.
# Usage: RENDER_API_KEY=rnd_... ./scripts/deploy-relay-render.sh
set -euo pipefail

API_KEY="${RENDER_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "Missing RENDER_API_KEY. Create one at https://dashboard.render.com/u/settings#api-keys" >&2
  exit 1
fi

REPO_URL="${RELAY_REPO_URL:-https://github.com/ramchandragada/asperaconnect}"
BRANCH="${RELAY_BRANCH:-cursor/phone-contacts-sync-5b4f}"
SERVICE_NAME="${RELAY_SERVICE_NAME:-aspera-connect-relay}"
OWNER_ID="${RENDER_OWNER_ID:-}"

auth=(-H "Authorization: Bearer ${API_KEY}" -H "Accept: application/json" -H "Content-Type: application/json")

echo "Looking up existing Render services named ${SERVICE_NAME}..."
SERVICES_JSON=$(curl -sS "${auth[@]}" "https://api.render.com/v1/services?limit=50")
EXISTING_ID=$(python3 - <<PY
import json,sys
data=json.loads('''${SERVICES_JSON}''')
# API returns list of {service: {...}} or bare list depending on version
items = data if isinstance(data, list) else data.get("items") or data.get("services") or []
for item in items:
    svc = item.get("service", item) if isinstance(item, dict) else {}
    if svc.get("name") == "${SERVICE_NAME}":
        print(svc.get("id",""))
        break
PY
)

if [[ -n "$EXISTING_ID" ]]; then
  echo "Service already exists: ${EXISTING_ID}"
  echo "Triggering deploy..."
  curl -sS -X POST "${auth[@]}" "https://api.render.com/v1/services/${EXISTING_ID}/deploys" \
    -d '{"clearCache":"do_not_clear"}' | python3 -m json.tool
  DETAIL=$(curl -sS "${auth[@]}" "https://api.render.com/v1/services/${EXISTING_ID}")
  python3 - <<PY
import json
d=json.loads('''${DETAIL}''')
svc=d.get("service", d)
url=svc.get("serviceDetails",{}).get("url") or svc.get("url") or ""
print("LIVE_URL="+url)
print("WSS_URL="+url.replace("https://","wss://").replace("http://","ws://"))
PY
  exit 0
fi

if [[ -z "$OWNER_ID" ]]; then
  echo "Resolving Render owner id..."
  OWNERS=$(curl -sS "${auth[@]}" "https://api.render.com/v1/owners?limit=20")
  OWNER_ID=$(python3 - <<PY
import json
data=json.loads('''${OWNERS}''')
items = data if isinstance(data, list) else data.get("items") or []
for item in items:
    owner = item.get("owner", item) if isinstance(item, dict) else {}
    oid = owner.get("id") or ""
    if oid:
        print(oid)
        break
PY
)
fi

if [[ -z "$OWNER_ID" ]]; then
  echo "Could not resolve RENDER_OWNER_ID. Set it and re-run." >&2
  echo "Owners response: ${OWNERS:-}" >&2
  exit 1
fi

echo "Creating web service ${SERVICE_NAME} (owner=${OWNER_ID})..."
CREATE_PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "type": "web_service",
  "name": "${SERVICE_NAME}",
  "ownerId": "${OWNER_ID}",
  "repo": "${REPO_URL}",
  "branch": "${BRANCH}",
  "rootDir": "apps/relay",
  "autoDeploy": "yes",
  "serviceDetails": {
    "env": "node",
    "envSpecificDetails": {
      "buildCommand": "npm install",
      "startCommand": "npm start"
    },
    "plan": "free",
    "region": "oregon",
    "healthCheckPath": "/health",
    "numInstances": 1
  },
  "envVars": [
    {"key": "NODE_VERSION", "value": "22"},
    {"key": "SESSION_TTL_MS", "value": "600000"}
  ]
}))
PY
)

CREATE_RESP=$(curl -sS -X POST "${auth[@]}" "https://api.render.com/v1/services" -d "$CREATE_PAYLOAD")
echo "$CREATE_RESP" | python3 -m json.tool || echo "$CREATE_RESP"

python3 - <<PY
import json,sys
try:
  d=json.loads('''${CREATE_RESP}''')
except Exception as e:
  print("Failed to parse create response", e, file=sys.stderr)
  sys.exit(1)
svc=d.get("service", d)
sid=svc.get("id","")
url=svc.get("serviceDetails",{}).get("url") or ""
if not sid:
  print("Create failed — full response above.", file=sys.stderr)
  sys.exit(1)
print("SERVICE_ID="+sid)
print("LIVE_URL="+url)
print("WSS_URL="+url.replace("https://","wss://").replace("http://","ws://"))
print("Wait 2–5 minutes for the first deploy to go Live, then curl LIVE_URL/health")
PY
