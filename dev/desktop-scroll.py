# The pane as the Claude desktop app drives it, outside the app: a headless
# session on stream-json, this script in the desktop's place. It opens /db,
# draws the pane, scrolls the body as the desktop does (the window has moved
# before it asks) and checks the engine leaves it there, then opens a table
# wide and narrow and checks where it stands.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/shop python3 dev/desktop-scroll.py
#
# Expects the sample database from dev/seed.sql. A pane that answered the
# desktop's scroll with its old offset made the desktop jump back each tick.

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE_CODE')}
env.setdefault('ANTHROPIC_API_KEY', 'sk-ant-unused')
env['CLAUDE_CONFIG_DIR'] = tempfile.mkdtemp(prefix='dbview-desktop-')
session = subprocess.Popen(
    ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--plugin-dir', ROOT],
    cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
lines: list[str] = []
threading.Thread(target=lambda: lines.extend(session.stdout), daemon=True).start()
asked = [0]
failed = []


def ask(request: dict, wait: float = 15) -> dict:
    asked[0] += 1
    rid = f'r{asked[0]}'
    session.stdin.write(json.dumps({'type': 'control_request', 'request_id': rid, 'request': request}) + '\n')
    session.stdin.flush()
    end = time.time() + wait
    while time.time() < end:
        for line in list(lines):
            if f'"request_id":"{rid}"' in line and 'control_response' in line:
                return json.loads(line)['response'].get('response', {})
        time.sleep(0.1)
    sys.exit(f'no answer to {request["subtype"]}')


def find(node, key):
    if isinstance(node, dict):
        if node.get('props', {}).get('key') == key:
            return node
        node = node.get('children') or []
    if isinstance(node, list):
        for child in node:
            hit = find(child, key)
            if hit:
                return hit
    return None


def draw(cols: int, offset: int) -> dict:
    props = {'title': 'Database', 'isFocused': True, 'bodyColumns': cols, 'placement': 'dock',
             'scroll': {'offset': offset, 'bodyRows': 20}, 'view': {}}
    return ask({'subtype': 'ui_render', 'surface': 'desktop', 'client_id': 'd1', 'component': 'Pane',
                'instance_id': 'dbview', 'props': props, 'content_rows': 200})['tree']


def press(tree: dict, key: str) -> None:
    ask({'subtype': 'ui_press', 'plugin': 'dbview', 'handle': find(tree, key)['press']['handle'], 'key': key,
         'surface': 'desktop', 'client_id': 'd1'})
    time.sleep(2)


def scroll(offset: int, by: int, column: int = 10) -> int:
    return ask({'subtype': 'ui_scroll', 'surface': 'desktop', 'client_id': 'd1', 'component': 'Pane',
                'instance_id': 'dbview', 'offset': offset, 'by': by, 'body_rows': 20, 'content_rows': 120,
                'pointer': {'column': column, 'row': 5}})['offset']


def redraws() -> int:
    return sum('"subtype":"ui_invalidate"' in line for line in list(lines))


def check(what: str, got, want) -> None:
    print(f'{"ok " if got == want else "BAD"} {what}: {got}' + ('' if got == want else f' (want {want})'))
    if got != want:
        failed.append(what)


time.sleep(3)
ask({'subtype': 'ui_attach', 'surface': 'desktop', 'client_id': 'd1'})
session.stdin.write(json.dumps({'type': 'user', 'message': {'role': 'user', 'content': '/db'}}) + '\n')
session.stdin.flush()
time.sleep(8)

tree = draw(140, 0)
for key in ['s:env|sales', 'f:env|sales|tables']:
    if not find(tree, 'r:env|sales.orders'):
        press(tree, key)
        tree = draw(140, 0)

for offset, by in [(5, 5), (8, 3), (4, -4)]:
    check(f'the window stays where the desktop moved it ({offset})', scroll(offset, by), offset)

press(draw(140, 6), 'r:env|sales.orders')
check('wide: the table opens at the window, beside its row', find(draw(140, 6), 'detail')['props'].get('marginTop'), 6)

# A wheel over the tree moves the page; once it rests, the table follows to the top.
before = redraws()
scroll(9, 3)
time.sleep(1)
check('wide: the pane asks for a redraw once the wheel rests', redraws() > before, True)
check('wide: once the wheel rests, the table is at the top again', find(draw(140, 9), 'detail')['props'].get('marginTop'), 9)
scroll(14, 5, column=90)
time.sleep(1)
check('wide: a wheel over the table leaves it where it is', find(draw(140, 14), 'detail')['props'].get('marginTop'), 9)

press(draw(60, 0), 'r:env|sales.customer')
keys = re.findall(r'"key": "([^"]+)"', json.dumps(draw(60, 0)))
check('narrow: the table opens under its row',
      [k for k in keys if k in ('r:env|sales.customer', 'detail', 'r:env|sales.orders')],
      ['r:env|sales.customer', 'detail', 'r:env|sales.orders'])

session.kill()
sys.exit(1 if failed else 0)
