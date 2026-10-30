import re
import subprocess

with open('/home/vaibhav/Desktop/HRWork/frontend/casedetail.html', 'r', encoding='utf-8') as f:
    html = f.read()

scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', html, re.DOTALL)
main_script = max(scripts, key=len)

with open('/tmp/main_script_raw.js', 'w', encoding='utf-8') as f:
    f.write(main_script)

test_runner = """
imports.gi.GLib;
const Gio = imports.gi.Gio;

function readFile(path) {
    let file = Gio.File.new_for_path(path);
    let [, contents] = file.load_contents(null);
    return new TextDecoder('utf-8').decode(contents);
}

const code = readFile('/tmp/main_script_raw.js');
try {
    // Compile code into a function to check syntax
    new Function(code);
    print("SUCCESS: JavaScript syntax is 100% VALID!");
} catch (err) {
    print("SYNTAX ERROR: " + err.message);
    print("Stack: " + err.stack);
    print("Line: " + err.lineNumber + ", Column: " + err.columnNumber);
}
"""

with open('/tmp/test_runner.js', 'w', encoding='utf-8') as f:
    f.write(test_runner)

res = subprocess.run(["gjs", "/tmp/test_runner.js"], capture_output=True, text=True)
print("STDOUT:", res.stdout)
print("STDERR:", res.stderr)

