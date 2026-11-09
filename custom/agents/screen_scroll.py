"""Configure private wheel keys on one existing GNU Screen server, never the child app."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys

UP = '\x1b[999;1~'
DOWN = '\x1b[999;2~'
LIVE = '\x1b[999;3~'


def configure(spec):
    foreground = spec.get('foreground', {})
    pid = foreground.get('pid')
    if not isinstance(pid, int) or pid <= 0:
        return {'configured': False}
    proc = Path('/proc') / str(pid)
    argv = [a.decode() for a in (proc / 'cmdline').read_bytes().split(b'\0') if a]
    if not argv or Path(argv[0]).name != 'screen' or proc.stat().st_uid != os.getuid():
        return {'configured': False}
    target = next((arg for arg in reversed(argv[1:]) if not arg.startswith('-')), '')
    # Existing attachment only. Reject ambiguous, option-like or malformed targets.
    if not target or target.startswith('-') or '/' in target or '\0' in target:
        return {'configured': False}
    listing = subprocess.run(['screen', '-ls'], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             universal_newlines=True, timeout=4)
    sessions = []
    for line in listing.stdout.splitlines():
        found = re.match(r'\s*(\d+\.\S+)\s+\(', line)
        if found and 'Dead' not in line:
            name = found.group(1)
            if name == target or name.split('.', 1)[1] == target:
                sessions.append(name)
    if len(sessions) != 1:
        return {'configured': False, 'error': 'Screen session name is missing or ambiguous'}
    target = sessions[0]
    commands = [
        ['bindkey', UP, 'copy'],
        ['bindkey', DOWN, 'stuff', ''],
        ['bindkey', '-m', UP, 'stuff', '\x19'],
        ['bindkey', '-m', DOWN, 'stuff', '\x05'],
        ['bindkey', LIVE, 'stuff', ''],
        ['bindkey', '-m', LIVE, 'stuff', '\x1b'],
    ]
    for command in commands:
        result = subprocess.run(['screen', '-S', target, '-X', *command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=4)
        if result.returncode or 'No screen session' in result.stdout + result.stderr:
            raise ValueError(result.stderr or result.stdout or 'Screen wheel setup failed')
    info = subprocess.run(['screen', '-S', target, '-Q', 'info'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=4)
    capacity = re.search(r'\+(\d+)', info.stdout)
    return {'configured': True, 'pid': pid, 'history': int(capacity.group(1)) if capacity else 10000}

if __name__ == '__main__':
    try:
        print(json.dumps(configure(json.loads(sys.argv[1]))))
    except Exception as error:
        print(json.dumps({'configured': False, 'error': str(error)}))
        sys.exit(1)
