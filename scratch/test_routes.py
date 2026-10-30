import re
from backend.server import create_app
from werkzeug.exceptions import MethodNotAllowed, NotFound

app = create_app()
adapter = app.url_map.bind('localhost')

files = [
    'frontend/js/sidebar.js',
    'frontend/js/inbox.js',
    'frontend/js/agent.js',
    'frontend/js/dashboard.js',
    'frontend/js/reports.js'
]

results = []

for fname in files:
    with open(fname, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Match fetch(...) up to 200 chars
    matches = re.finditer(r'fetch\(([\s\S]*?)\)', content)
    for m in matches:
        body = m.group(1).strip()
        first_arg = body.split(',')[0].strip()
        # Find method if there is second arg
        method = 'GET'
        m_method = re.search(r'method:\s*[\'\"]([A-Z]+)[\'\"]', body, re.IGNORECASE)
        if m_method:
            method = m_method.group(1).upper()
        
        # Check if first_arg contains /api/
        if '/api/' not in first_arg:
            continue
            
        clean_url = first_arg.strip('`\'"')
        clean_url = re.sub(r'\$\{[^}]*id[^}]*\}', '1', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*case[^}]*\}', 'CASE-2026-0001', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*mail[^}]*\}', '1', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*email[^}]*\}', 'test@example.com', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*user[^}]*\}', 'admin', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*dept[^}]*\}', '1', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*role[^}]*\}', 'ADMIN', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*action[^}]*\}', '1', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*status[^}]*\}', 'OPEN', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*params[^}]*\}', '', clean_url, flags=re.I)
        clean_url = re.sub(r'\$\{[^}]*\}', '1', clean_url)
        clean_url = clean_url.replace('${BACKEND_API_BASE}', '')
        clean_url = clean_url.replace('${API_BASE}', '')
        clean_url = clean_url.replace('${API}', '')
        
        path_only = clean_url.split('?')[0].strip()
        # Clean quotes or spaces
        path_only = path_only.replace("'", "").replace('"', '').replace('`', '')
        if not path_only.startswith('/api/'):
            # Maybe path starts inside
            idx = path_only.find('/api/')
            if idx != -1:
                path_only = path_only[idx:]
            else:
                continue
        
        # remove anything after space or concatenation
        path_only = path_only.split()[0].split('+')[0].strip()
        
        try:
            matched_endpoint, args = adapter.match(path_only, method=method)
            results.append((fname, method, path_only, "OK", matched_endpoint))
        except MethodNotAllowed as e:
            results.append((fname, method, path_only, f"METHOD_NOT_ALLOWED (allowed: {e.valid_methods})", None))
        except NotFound:
            results.append((fname, method, path_only, "NOT_FOUND", None))
        except Exception as e:
            results.append((fname, method, path_only, str(e), None))

print(f"Total endpoints tested: {len(results)}")
broken = [r for r in results if r[3] != "OK"]
print(f"Total broken endpoints: {len(broken)}")
for b in set(broken):
    print(f"[{b[0]}] {b[1]} {b[2]} -> {b[3]}")
