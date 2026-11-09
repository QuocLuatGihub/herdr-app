import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../custom/voice/mod/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ')
  .replace('export default class Voice', 'class Voice');
function harness(call: (args: string[]) => Promise<any>, list = [{address:'remote/t7',state:'live'}]) {
  const Voice = new Function('View', 'terminals', 'hc', `${source}; return Voice;`)(class {}, () => list, call);
  const voice = new Voice();
  const field = (text: string) => ({value: () => text, set_value: (value: string) => {text=value;}});
  voice.target='remote/t7'; voice.draft=field('kiểm tra project'); voice.response=field('');
  const pending: Promise<any>[]=[];
  const cx = {notify(){},spawn(fn: any){pending.push(fn(cx));}};
  return {voice,cx,pending};
}
test('the reviewed target stays pinned when another terminal gains focus', async () => {
  let sent: string[]=[];
  const h=harness(async args => {sent=args;return {code:0,stdout:'{"sent":true}'};});
  h.voice.send(h.cx);
  h.voice.target='local/t2';
  await Promise.all(h.pending);
  expect(sent).toEqual(['send','--json','remote/t7','kiểm tra project']);
  expect(h.voice.draft.value()).toBe('');
});
test('permission/blocked errors keep the draft and never force a send', async () => {
  let sent: string[]=[];
  const h=harness(async args => {sent=args;return {code:9,stderr:'needs approval'};});
  h.voice.send(h.cx); await Promise.all(h.pending);
  expect(sent).not.toContain('--force');
  expect(h.voice.draft.value()).toBe('kiểm tra project');
  expect(h.voice.error).toBe('needs approval');
});
test('a vanished target or empty draft cannot receive voice input', () => {
  let calls=0;
  const h=harness(async () => {calls++;return {};}, []);
  h.voice.send(h.cx);
  expect(calls).toBe(0);
  const empty=harness(async () => {calls++;return {};});
  empty.voice.draft.set_value('  '); empty.voice.send(empty.cx);
  expect(calls).toBe(0);
});
test('failed delivery reported in JSON keeps the draft', async () => {
  const h=harness(async () => ({code:0,stdout:'{"sent":false,"reason":"not ready"}'}));
  h.voice.send(h.cx); await Promise.all(h.pending);
  expect(h.voice.draft.value()).toBe('kiểm tra project');
});
test('screen preview strips escape codes and bounds speech length', () => {
  const clean = new Function("View", `${source}; return screenText;`)(class {});
  expect(clean(JSON.stringify({text:'\x1b[31mXin chào\x1b[0m'}))).toBe('Xin chào');
  expect(clean(JSON.stringify({text:'x'.repeat(7000)}))).toHaveLength(6000);
  expect(() => clean('{}')).toThrow();
});

test('live previews preserve edits and include an existing draft', () => {
  const h=harness(async () => ({}));
  h.voice.liveBase='Lời nhắn cũ\n'; h.voice.liveApplied=h.voice.draft.value();
  h.voice.applyLive('phần mới');
  expect(h.voice.draft.value()).toBe('Lời nhắn cũ\nphần mới');
  h.voice.draft.set_value('anh đã sửa');
  h.voice.applyLive('kết quả đến muộn');
  expect(h.voice.draft.value()).toBe('anh đã sửa');
});
test('Send during recording requests finalization without sending partial text', () => {
  let calls=0;
  const h=harness(async () => {calls++;return {};});
  h.voice.busy=true; h.voice.recordJob='recording';
  let stopped=false; h.voice.stopRecord=() => {stopped=true;};
  h.voice.send(h.cx);
  expect(h.voice.sendAfterRecord).toBe(true);
  expect(stopped).toBe(true);
  expect(calls).toBe(0);
});

test('one Send click waits for the final transcript, then delivers exactly once', async () => {
  let sent: string[][]=[];
  const h=harness(async args => {sent.push(args);return {code:0,stdout:'{}'};});
  h.voice.draft.set_value('');
  let finish: any;
  h.voice.worker=(action: string) => action==='record'
    ? new Promise(resolve => {finish=resolve;})
    : Promise.resolve({code:0,stdout:'{}'});
  h.voice.toggleRecord(h.cx);
  h.voice.applyLive('kiểm tra');
  h.voice.send(h.cx);
  expect(sent).toHaveLength(0);
  finish({code:0,stdout:JSON.stringify({text:'kiểm tra dự án'})});
  await h.pending[0]; await Promise.all(h.pending);
  expect(sent).toEqual([['send','--json','remote/t7','kiểm tra dự án']]);
});
test('recognition failure never triggers a queued Send', async () => {
  let sends=0;
  const h=harness(async () => {sends++;return {};});
  let finish: any;
  h.voice.worker=(action: string) => action==='record'
    ? new Promise(resolve => {finish=resolve;})
    : Promise.resolve({code:0,stdout:'{}'});
  h.voice.toggleRecord(h.cx); h.voice.send(h.cx);
  finish({code:1,stderr:'Microphone denied'});
  await Promise.all(h.pending);
  expect(sends).toBe(0);
  expect(h.voice.draft.value()).toBe('kiểm tra project');
});
