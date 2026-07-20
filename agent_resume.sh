#!/bin/bash
# agent_resume.sh - Loads persisted state and prepares the agent for continuation
# This script is designed to run on boot/startup

STATE_FILE="/workspace/agent_state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "No persisted state found. Starting fresh."
    exit 0
fi

echo "========================================="
echo "  AGENT PERSISTENCE SYSTEM: LOADING STATE"
echo "========================================="

# Extract key info from state
ACTIVE_GOAL=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['active_goal']['description'])" 2>/dev/null || echo "Unknown goal")
STATUS=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['active_goal']['status'])" 2>/dev/null || echo "unknown")

echo ""
echo "Current Goal: $ACTIVE_GOAL"
echo "Status: $STATUS"
echo "Last Checkpoint: $(python3 -c "import json; print(json.load(open('$STATE_FILE'))['last_checkpoint'] or 'Never')" 2>/dev/null)"
echo ""

# Get pending tasks
echo "--- Pending Tasks ---"
python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
pending = state.get('pending_tasks', [])
if pending:
    for task in pending[:5]:  # Show top 5
        print(f'  [{task[\"id\"]}] ({task[\"priority\"]}) {task[\"description\"]}')
else:
    print('  (none)')
" 2>/dev/null

echo ""
echo "--- Context Notes (Last 3) ---"
python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
notes = state.get('context_notes', [])[-3:]
for note in notes:
    print(f'  {note[\"timestamp\"]}: [{note[\"category\"]}] {note[\"content\"]}')
" 2>/dev/null

echo ""
echo "Resume: Agent should continue from 'work_in_progress' -> 'next_step'"
echo "========================================="
echo ""

# Update resume timestamp
python3 -c "
import json
with open('$STATE_FILE', 'r') as f:
    state = json.load(f)
state['booted_at'] = '$(date -u +"%Y-%m-%dT%H:%M:%SZ")'
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null
