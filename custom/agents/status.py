"""Read-only Codex daemon status over its local Unix WebSocket. No screen scraping."""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import time


class Daemon:
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(str(path))
        self.buffer = b''
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        while b'\r\n\r\n' not in self.buffer:
            data = self.sock.recv(4096)
            if not data:
                raise ValueError("Codex daemon disconnected during handshake")
            self.buffer += data
            if len(self.buffer) > 65536:
                raise ValueError('Invalid WebSocket handshake')
        header, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        fields = {line.split(b':', 1)[0].lower(): line.split(b':', 1)[1].strip() for line in header.split(b'\r\n')[1:] if b':' in line}
        if b' 101 ' not in header.split(b'\r\n')[0] or fields.get(b'sec-websocket-accept') != accept:
            raise ValueError('Codex daemon rejected the connection')
        self.counter = 0
        self.request('initialize', {'clientInfo': {'name': 'herdr_status_reader', 'version': '0.1'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized'})

    def exact(self, size):
        while len(self.buffer) < size:
            data = self.sock.recv(max(4096, size - len(self.buffer)))
            if not data:
                raise ValueError('Codex daemon disconnected')
            self.buffer += data
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result

    def frame(self, opcode, payload):
        mask = os.urandom(4)
        size = len(payload)
        head = bytes([0x80 | opcode, 0x80 | (size if size < 126 else 126 if size < 65536 else 127)])
        if size >= 126:
            head += struct.pack('!H' if size < 65536 else '!Q', size)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, value):
        self.frame(1, json.dumps(value).encode())

    def receive(self):
        message = b''
        while True:
            first, second = self.exact(2)
            opcode = first & 15
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.exact(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.exact(8))[0]
            if size + len(message) > 8 * 1024 * 1024 or second & 128:
                raise ValueError('Invalid WebSocket frame')
            payload = self.exact(size)
            if opcode == 8:
                raise ValueError('Codex daemon closed the connection')
            if opcode == 9:
                self.frame(10, payload)
                continue
            if opcode == 10:
                continue
            if opcode not in (0, 1):
                raise ValueError('Unexpected WebSocket message')
            message += payload
            if first & 128:
                return json.loads(message)

    def request(self, method, params):
        if method not in ('initialize', 'thread/list'):
            raise ValueError('Only read-only daemon requests are allowed')
        self.counter += 1
        identifier = self.counter
        self.send({'id': identifier, 'method': method, 'params': params})
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            response = self.receive()
            if response.get('id') == identifier:
                if 'error' in response:
                    raise ValueError(response['error'].get('message', 'Codex daemon error'))
                return response['result']
        raise ValueError('Codex daemon status timed out')

    def threads(self):
        result, cursor = [], None
        for _ in range(4):
            page = self.request('thread/list', {'limit': 100, 'cursor': cursor, 'sortKey': 'updated_at'})
            result.extend(t for t in page.get('data', []) if t.get('status', {}).get('type') != 'notLoaded' and not t.get('parentThreadId'))
            cursor = page.get('nextCursor')
            if not cursor:
                break
        return result


def state(status):
    kind = status.get('type')
    if kind == 'idle':
        return 'idle'
    if kind == 'systemError':
        return 'blocked'
    if kind == 'active':
        return 'blocked' if any(f in ('waitingOnApproval', 'waitingOnUserInput') for f in status.get('activeFlags', [])) else 'working'
    return None


def screen_cwds(spec):
    pid = str(spec.get('foreground', {}).get('pid', ''))
    if not pid.isdigit():
        return set()
    command = (Path('/proc') / pid / 'cmdline').read_bytes().split(b'\0')
    args = [p.decode(errors='replace') for p in command if p]
    if not args or Path(args[0]).name != 'screen':
        return set()
    target = next((arg for arg in reversed(args[1:]) if not arg.startswith('-')), '')
    if not target:
        return set()
    found = set()
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if Path(os.readlink(proc / 'exe')).name != 'codex':
                continue
            environ = (proc / 'environ').read_bytes().split(b'\0')
            sty = next((v[4:].decode(errors='replace') for v in environ if v.startswith(b'STY=')), '')
            if sty == target or sty.endswith('.' + target):
                found.add(os.path.realpath(proc / 'cwd'))
        except OSError:
            continue
    return found


def match(spec, threads):
    folders = screen_cwds(spec)
    candidates = [t for t in threads if os.path.realpath(t.get('cwd', '')) in folders]
    bound = spec.get('labels', {}).get('custom.codex.thread')
    if bound:
        candidates = [t for t in candidates if t['id'] == bound]
    if len(candidates) != 1:
        return {'status': 'unknown', 'reason': 'Không tìm thấy thread đang nạp' if not candidates else 'Có nhiều thread cùng thư mục'}
    thread = candidates[0]
    return {'status': state(thread['status']) or 'unknown', 'threadId': thread['id'], 'name': thread.get('name'), 'source': 'codex-app-server'}


def main():
    specs = json.loads(sys.argv[1])
    daemon = None
    try:
        daemon = Daemon(Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'app-server-control/app-server-control.sock')
        threads = daemon.threads()
        result = {}
        for spec in specs:
            try:
                result[spec['address']] = match(spec, threads)
            except OSError as error:
                result[spec['address']] = {'status': 'unknown', 'reason': str(error)}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({s['address']: {'status': 'unknown', 'reason': str(error)} for s in specs}, ensure_ascii=False))
    finally:
        if daemon:
            daemon.sock.close()

if __name__ == '__main__':
    main()
