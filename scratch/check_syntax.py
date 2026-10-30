import sys

with open('/tmp/inline_script.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Let's write a tokenizer/lexer for JS strings, template literals, comments, and brackets
i = 0
n = len(code)
stack = []
line = 1
col = 1

while i < n:
    c = code[i]
    if c == '\n':
        line += 1
        col = 1
        i += 1
        continue
    
    # Comments
    if c == '/' and i + 1 < n and code[i+1] == '/':
        # Line comment
        while i < n and code[i] != '\n':
            i += 1
        continue
    elif c == '/' and i + 1 < n and code[i+1] == '*':
        # Block comment
        start_line, start_col = line, col
        i += 2
        while i + 1 < n and not (code[i] == '*' and code[i+1] == '/'):
            if code[i] == '\n':
                line += 1
            i += 1
        if i + 1 >= n:
            print(f"Unclosed block comment starting at line {start_line}:{start_col}")
            sys.exit(1)
        i += 2
        continue
    
    # Strings: single or double quote
    if c in ('"', "'"):
        quote = c
        start_line, start_col = line, col
        i += 1
        col += 1
        while i < n and code[i] != quote:
            if code[i] == '\\':
                i += 2
                col += 2
            elif code[i] == '\n':
                print(f"Newline inside string literal {quote} at line {line}:{col}")
                i += 1
                line += 1
                col = 1
            else:
                i += 1
                col += 1
        if i >= n:
            print(f"Unclosed string {quote} starting at line {start_line}:{start_col}")
            sys.exit(1)
        i += 1
        col += 1
        continue
        
    # Template literal: `
    if c == '`':
        start_line, start_col = line, col
        stack.append(('`', start_line, start_col))
        i += 1
        col += 1
        while i < n:
            ch = code[i]
            if ch == '\\':
                i += 2
                col += 2
            elif ch == '`':
                stack.pop()
                i += 1
                col += 1
                break
            elif ch == '$' and i + 1 < n and code[i+1] == '{':
                # Expression inside template literal
                stack.append(('${', line, col))
                i += 2
                col += 2
                break
            elif ch == '\n':
                line += 1
                col = 1
                i += 1
            else:
                i += 1
                col += 1
        continue

    if c == '{':
        stack.append(('{', line, col))
    elif c == '}':
        if not stack:
            print(f"Unexpected closing '}}' at line {line}:{col}")
        else:
            top = stack[-1]
            if top[0] == '${':
                stack.pop()
                # We returned from an expression inside a template literal, now we continue reading template literal!
                i += 1
                col += 1
                while i < n:
                    ch = code[i]
                    if ch == '\\':
                        i += 2
                        col += 2
                    elif ch == '`':
                        stack.pop() # pop the '`'
                        i += 1
                        col += 1
                        break
                    elif ch == '$' and i + 1 < n and code[i+1] == '{':
                        stack.append(('${', line, col))
                        i += 2
                        col += 2
                        break
                    elif ch == '\n':
                        line += 1
                        col = 1
                        i += 1
                    else:
                        i += 1
                        col += 1
                continue
            elif top[0] == '{':
                stack.pop()
            else:
                print(f"Mismatched '}}' at line {line}:{col}, top was {top}")
    elif c == '(':
        stack.append(('(', line, col))
    elif c == ')':
        if not stack:
            print(f"Unexpected closing ')' at line {line}:{col}")
        else:
            top = stack[-1]
            if top[0] == '(':
                stack.pop()
            else:
                print(f"Mismatched ')' at line {line}:{col}, top was {top}")
    elif c == '[':
        stack.append(('[', line, col))
    elif c == ']':
        if not stack:
            print(f"Unexpected closing ']' at line {line}:{col}")
        else:
            top = stack[-1]
            if top[0] == '[':
                stack.pop()
            else:
                print(f"Mismatched ']' at line {line}:{col}, top was {top}")
    
    i += 1
    col += 1

print(f"Finished parsing. Stack length: {len(stack)}")
if stack:
    print(f"Remaining stack items (last 10): {stack[-10:]}")

