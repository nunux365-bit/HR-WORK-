import re
from backend.server import create_app

app = create_app()
registered_rules = set()
for rule in app.url_map.iter_rules():
    registered_rules.add(rule.rule)

print(f"Total registered backend routes: {len(registered_rules)}")

files = ['frontend/js/sidebar.js', 'frontend/js/inbox.js', 'frontend/js/agent.js', 'frontend/js/dashboard.js']
all_called = set()

for fname in files:
    with open(fname, 'r', encoding='utf-8') as f:
        content = f.read()
    matches = re.findall(r'/api/[a-zA-Z0-9_\-\/]+', content)
    for m in matches:
        all_called.add((fname, m))

print(f"Total /api/ endpoints referenced: {len(all_called)}")

# Let's check for each called endpoint if it matches any registered Flask rule
unmatched = []
for fname, endpoint in sorted(all_called):
    # Test if endpoint matches any registered rule
    matched = False
    for rule in registered_rules:
        # Simple regex matcher
        rule_regex = '^' + re.sub(r'<[^>]+>', r'[^/]+', rule) + '$'
        if re.match(rule_regex, endpoint):
            matched = True
            break
    if not matched:
        unmatched.append((fname, endpoint))

print("\n--- UNMATCHED / POTENTIALLY BROKEN ENDPOINTS ---")
for fn, ep in unmatched:
    print(f"[{fn}] {ep}")

