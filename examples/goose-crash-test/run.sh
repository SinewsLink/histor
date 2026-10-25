#!/usr/bin/env bash
# Reproduces the goose crash-and-redispatch test (Dapr-style at-least-once execution), with and without SL Histor.
# Needs: goose CLI on PATH (tested 1.56.0), Node 20+, `npm install` done at the repo root. No API key: a scripted model is used.
set -u
cd "$(dirname "$0")"; HERE=$(pwd); ROOT=$(cd ../.. && pwd)
GOOSE=${GOOSE:-goose}; HISTOR="node $ROOT/packages/cli/bin/histor.js"; PROXY="$ROOT/packages/mcp-proxy/bin/histor-mcp-proxy.js"
export HOME="$HERE/.home" GOOSE_PROVIDER=openai GOOSE_MODEL=gpt-4o OPENAI_HOST=http://127.0.0.1:8765 OPENAI_API_KEY=fake
export GOOSE_DISABLE_KEYRING=1 GOOSE_MODE=auto GOOSE_TELEMETRY_ENABLED=false NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
rm -rf .home .histor transfers.log fake-model.log tool-result-seen hang.flag; mkdir -p .home
node fake-model.js & FM=$!; trap 'kill $FM 2>/dev/null' EXIT; sleep 1
PROMPT="Transfer 500 from acct-A to acct-B"

turn() { # turn <session> <crash:0|1> [extension]
  rm -f tool-result-seen; [ "$2" = 1 ] && touch hang.flag || rm -f hang.flag
  if [ -n "${3:-}" ]; then $GOOSE run -n "$1" --with-extension "$3" -t "$PROMPT" >/dev/null 2>&1 & else $GOOSE run -n "$1" --resume -t "$PROMPT" >/dev/null 2>&1 & fi
  local G=$!
  if [ "$2" = 1 ]; then
    for _ in $(seq 1 120); do [ -f tool-result-seen ] && break; sleep 0.25; done; sleep 0.3
    { kill -9 $G; pkill -9 -f "^node $HERE/bank-mcp-server.js"; pkill -9 -f "^node $PROXY"; wait $G; } 2>/dev/null
  else wait $G; fi
  rm -f hang.flag
}
count() { [ -f transfers.log ] && wc -l < transfers.log | tr -d ' ' || echo 0; }

echo "== A: goose alone. Turn runs, worker crashes after the transfer, turn is redispatched"
turn sessA 1 "bank:node $HERE/bank-mcp-server.js"; turn sessA 0
echo "   transfers executed: $(count)   (the same \$500 moved twice)"
rm -f transfers.log

echo "== B: goose with SL Histor wrapping the same MCP server"
$HISTOR init --witness .histor >/dev/null
node -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f));c.principal={subject_id:"founder@sinewslink.com",idp:"local",authenticated:false};c.agent={agent_id:"goose-ops",name:"goose"};c.server={name:"bank"};require("fs").writeFileSync(f,JSON.stringify(c,null,2))' .histor/histor.config.json
turn sessB 0 "bank:node $PROXY --config $HERE/.histor/histor.config.json -- node $HERE/bank-mcp-server.js"
RID=$($HISTOR pending --witness .histor | awk 'NR==1{print $1}')
echo "   blocked, approval requested: $RID   transfers so far: $(count)"
$HISTOR approve "$RID" --approver founder@sinewslink.com --witness .histor 2>&1 | sed 's/^/   self-approval: /'
$HISTOR approve "$RID" --approver ops-lead@sinewslink.com --witness .histor | sed 's/^/   /'
turn sessB 1; echo "   approved call ran, then the worker crashed. transfers: $(count)"
turn sessB 0; echo "   redispatched turn retried the identical call. transfers: $(count)   (blocked: approval already used)"
for f in .histor/ledger/*.jsonl; do $HISTOR inspect "$f" --witness .histor | grep -E "action|denial" | sed 's/^/   /'; done
