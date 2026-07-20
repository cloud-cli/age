#!/bin/bash
# agent_checkpoint.sh - Auto-saves agent state and progress
# Usage: ./agent_checkpoint.sh "description" [--file FILE_PATH] [--action ACTION_TYPE]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/agent_state.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

ACTION="${3:-checkpoint}"
FILE_PATH="$4"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: agent_state.json not found. Creating new state..."
    echo "{}" > "$STATE_FILE"
fi

python3 << 'PYTHON_EOF'
import json
import sys
from datetime import datetime

state_file = sys.argv[1] if len(sys.argv) > 1 else "agent_state.json"
description = sys.argv[2] if len(sys.argv) > 2 else "No description"
filepath = sys.argv[3] if len(sys.argv) > 3 else None
timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

with open(state_file, 'r') as f:
    state = json.load(f)

state['work_in_progress'] = {
    'current_file': filepath,
    'last_action': description,
    'next_step': 'Continuing current task chain'
}
state['last_checkpoint'] = timestamp

if 'context_notes' not in state:
    state['context_notes'] = []
state['context_notes'].append({
    'timestamp': timestamp,
    'category': 'progress',
    'content': description + (f" (File: {filepath})" if filepath else '')
})

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

print(f'✓ State checkpointed at {timestamp}')
PYTHON_EOF
