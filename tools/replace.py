#!/usr/bin/env python3
"""Exact-string replace, like an editor's find/replace but strict.

Usage:  python3 tools/replace.py FILE [--all] <<'EOF'
<<<<<<< OLD
text to find (exact, including indentation)
=======
replacement text
>>>>>>> NEW
EOF

Several OLD/NEW blocks may follow each other. Fails (exit 1, file untouched)
if any OLD text is missing, or appears more than once without --all.
"""
import re
import sys

def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    replace_all = "--all" in sys.argv[2:]
    spec = sys.stdin.read()
    blocks = re.findall(r"<<<<<<< OLD\n(.*?)\n?=======\n(.*?)\n?>>>>>>> NEW", spec, re.S)
    if not blocks:
        sys.exit("replace.py: no <<<<<<< OLD / ======= / >>>>>>> NEW blocks on stdin")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for i, (old, new) in enumerate(blocks, 1):
        count = text.count(old)
        if count == 0:
            sys.exit(f"replace.py: block {i}: OLD text not found in {path}")
        if count > 1 and not replace_all:
            sys.exit(f"replace.py: block {i}: OLD text appears {count} times in {path}; add more context or pass --all")
        text = text.replace(old, new) if replace_all else text.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"replace.py: {len(blocks)} block(s) applied to {path}")

if __name__ == "__main__":
    main()
