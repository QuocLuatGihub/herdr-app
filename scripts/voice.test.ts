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
