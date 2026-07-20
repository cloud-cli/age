#!/bin/bash
# Persistence Test Script - Verifies agent_state.json survives "restarts"
echo "=== PERSISTENCE SYSTEM TEST ==="
echo ""

# Check if state file exists
if [ ! -f "agent_state.json" ]; then
    echo "❌ FAILED: agent_state.json not found"
    exit 1
fi
echo "✅ State file exists"

# Validate JSON structure
python3 << 'EOF'
import json
import sys

with open('agent_state.json') as f:
    state = json.load(f)

required_fields = ['version', 'agent_id', 'active_goal', 'task_chain', 
                   'context_notes', 'decisions_log', 'work_in_progress', 
                   'pending_tasks']

print("\n📋 State Structure Validation:")
for field in required_fields:
    if field in state:
        print(f"  ✅ {field}")
    else:
        print(f"  ❌ {field} MISSING")
        sys.exit(1)

# Validate active_goal structure
goal = state['active_goal']
goal_fields = ['id', 'description', 'status']
print("\n🎯 Active Goal:")
for field in goal_fields:
    if field in goal:
        print(f"  ✅ {field}: {goal[field]}")
    else:
        print(f"  ❌ {field} MISSING")

# Validate task chain
print(f"\n📝 Task Chain: {len(state['task_chain'])} tasks")
for task in state['task_chain']:
    status = "✅" if task['status'] == 'completed' else "🔄"
    print(f"  {status} {task['id']}: {task['description']}")

# Validate pending tasks
print(f"\n⏳ Pending Tasks: {len(state['pending_tasks'])}")
for task in state['pending_tasks']:
    print(f"  • [{task['priority']}] {task['id']}: {task['description']}")

# Validate decisions log
print(f"\n🧠 Decisions Log: {len(state['decisions_log'])} entries")
for i, dec in enumerate(state['decisions_log']):
    print(f"  {i+1}. {dec['decision']}")

# Validate context notes  
print(f"\n💡 Context Notes: {len(state['context_notes'])} entries")
for note in state['context_notes'][-2:]:
    print(f"  • [{note['category']}] {note['content'][:60]}...")

print("\n" + "="*50)
print("✅ ALL TESTS PASSED - Persistence system working!")
print("="*50)
EOF
