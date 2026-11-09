#!/usr/bin/env python3
"""Local audio worker. No shell commands, cloud APIs, or global process kills."""
import argparse
import array
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import wave

ROOT = Path.home() / '.local/share/herdr-voice'
JOBS = ROOT / 'jobs'
MODEL = ROOT / 'models/ggml-small-q5_1.bin'


def job_dir(identifier):
    if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier):
        raise ValueError('Invalid recording ID')
    path = JOBS / identifier
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def has_speech(path):
    with wave.open(str(path)) as f:
        if f.getsampwidth() != 2 or f.getnchannels() != 1 or f.getframerate() != 16000:
            raise ValueError('Expected mono 16 kHz PCM16 audio')
        samples = array.array('h', f.readframes(f.getnframes()))
    return bool(samples) and (sum(s * s for s in samples) / len(samples)) ** 0.5 > 70


def transcribe(path, language):
    if not MODEL.is_file():
        raise ValueError('Whisper model missing. Run scripts/setup-voice-macos.')
    if not has_speech(path):
        raise ValueError('No speech detected. Move closer to the microphone and retry.')
    result = subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', str(MODEL),
        '-f', str(path), '-l', language, '-nt', '-np', '-sns', '-t', '4'],
        capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError('Whisper failed: ' + result.stderr[-1000:])
    text = result.stdout.strip()
    if not text:
        raise ValueError('No words recognized. Please try again.')
    return text


def merge_chunks(chunks, output):
    """Read only finalized segments; the current microphone file is never read."""
    with wave.open(str(output), 'wb') as target:
        target.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        for chunk in chunks:
            with wave.open(str(chunk)) as source:
                if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
                    raise ValueError('Unexpected microphone audio format')
                target.writeframes(source.readframes(source.getnframes()))


def publish(job, **status):
    pending = job / 'status.new'
    pending.write_text(json.dumps(status, ensure_ascii=False))
    pending.replace(job / 'status.json')


def record_session(job, language):
    proc = subprocess.Popen([str(ROOT / 'herdr-recorder'), str(job / 'audio.wav'),
        str(job / 'stop'), str(job / 'ready')], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    text = ''
    count = 0
    deadline = time.monotonic() + 155
    try:
        while True:
            finished = proc.poll() is not None
            if (job / 'cancel').exists():
                (job / 'stop').touch()
                proc.wait(timeout=5)
                return ''
            if time.monotonic() > deadline and not finished:
                raise ValueError('Recording timed out')
            chunks = sorted(job.glob('chunk-*.wav'))
            if len(chunks) != count:
                count = len(chunks)
                publish(job, ready=True, phase='finalizing' if finished else 'recording', text=text)
                merge_chunks(chunks, job / 'preview.wav')
                if has_speech(job / 'preview.wav'):
                    text = transcribe(job / 'preview.wav', language)
                publish(job, ready=True, phase='finalizing' if finished else 'recording', text=text)
            if finished:
                error = proc.stderr.read().decode(errors='replace')
                if proc.returncode:
                    raise ValueError(error.strip() or 'Microphone recording failed')
                if not text:
                    raise ValueError('No speech detected. Please try again.')
                return text
            time.sleep(0.15)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stderr.close()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'stop', 'status', 'speak', 'stop-speaking', 'cancel', 'check'])
    parser.add_argument('job', nargs='?', default='check')
    parser.add_argument('value', nargs='?', default='vi')
    args = parser.parse_args()
    if args.action == 'check':
        print(json.dumps({'model': MODEL.is_file(), 'recorder': (ROOT / 'herdr-recorder').is_file(),
            'whisper': Path('/opt/homebrew/bin/whisper-cli').is_file()}))
        return
    job = job_dir(args.job)
    if args.action in ('stop', 'stop-speaking', 'cancel'):
        (job / 'stop').touch()
        if args.action == 'cancel':
            (job / 'cancel').touch()
    elif args.action == 'status':
        status_file = job / 'status.json'
        status = json.loads(status_file.read_text()) if status_file.exists() else {}
        status['ready'] = (job / 'ready').exists()
        print(json.dumps(status, ensure_ascii=False))
    elif args.action == 'record':
        if args.value not in ('vi', 'en', 'auto'):
            raise ValueError('Unsupported language')
        try:
            text = record_session(job, args.value)
            print(json.dumps({'text': text}, ensure_ascii=False))
        finally:
            for path in job.glob('*.wav'):
                path.unlink(missing_ok=True)
            for name in ('stop', 'ready', 'cancel', 'status.json', 'status.new'):
                (job / name).unlink(missing_ok=True)
            try:
                job.rmdir()
            except OSError:
                pass
    elif args.action == 'speak':
        # Text arrives as one argument; never evaluated as shell syntax.
        if not args.value.strip() or len(args.value) > 6000:
            raise ValueError('Speech text must contain 1–6000 characters')
        proc = subprocess.Popen(['/usr/bin/say', '-v', 'Linh', '--', args.value], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 180
            while proc.poll() is None:
                if (job / 'stop').exists() or time.monotonic() > deadline:
                    proc.terminate()
                    break
                time.sleep(0.1)
            _, error = proc.communicate(timeout=5)
            if proc.returncode not in (0, -15):
                raise ValueError(error.decode(errors='replace') or 'Speech failed')
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            (job / 'stop').unlink(missing_ok=True)
            try:
                job.rmdir()
            except OSError:
                pass


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
