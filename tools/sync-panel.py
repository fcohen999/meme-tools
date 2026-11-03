#!/usr/bin/env python3
"""Keep the shared editing-panel CSS the same in every tool page.

The block between <!-- panel-css:start --> and <!-- panel-css:end --> in editor.html
is the one to edit. This copies it into the other pages that have the block.

    python3 tools/sync-panel.py          copy editor.html's block into the other pages
    python3 tools/sync-panel.py --check  only report pages whose block differs (exit 1 if any)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'editor.html'
PAGES = [ROOT / 'social.html']
BLOCK = re.compile(r'<!-- panel-css:start -->.*?<!-- panel-css:end -->', re.S)

def block(text, name):
    found = BLOCK.findall(text)
    if len(found) != 1:
        sys.exit(f'{name}: expected one panel-css block, found {len(found)}')
    return found[0]

def main():
    check = '--check' in sys.argv[1:]
    src = block(SOURCE.read_text(encoding='utf-8'), SOURCE.name)
    differ = []
    for page in PAGES:
        text = page.read_text(encoding='utf-8')
        if block(text, page.name) == src:
            print(f'{page.name}: in step')
            continue
        differ.append(page.name)
        if check:
            print(f'{page.name}: DIFFERS from {SOURCE.name}')
        else:
            page.write_text(BLOCK.sub(lambda m: src, text, count=1), encoding='utf-8')
            print(f'{page.name}: updated')
    if check and differ:
        sys.exit(1)

if __name__ == '__main__':
    main()
