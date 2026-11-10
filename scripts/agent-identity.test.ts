import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../custom/agents/identity.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('export const ','const ').replaceAll('export function ','function ');
const {decoratePanes,mergeAgents} = new Function(`${source}; return {decoratePanes,mergeAgents};`)();
const pane=(terminal:string, app:any=null)=>({pane:'pane-'+terminal,terminal,tab:'remote/tab1',title:'contributor.ai-viet.com.vn',app,program:{name:'screen'},focused:true});
const terminal=(address:string,marked=true,state='live')=>({address,state,labels:marked?{'custom.agent':'codex'}:{}});
const spaces=[{id:'remote/s1',name:'Project',tabs:[{id:'remote/tab1',index:1,name:'contributor'}]}];
test('only the exact marked terminal gets a Codex icon',()=>{
 const result=decoratePanes([pane('remote/t2'),pane('t2'),pane('remote/t3')],[terminal('remote/t2'),terminal('t2',false),terminal('remote/t3',false)]);
 expect(result.map((p:any)=>p.program.name)).toEqual(['Codex','screen','screen']);
});
test('manual identity adds an unknown-state UI row without claiming idle or working',()=>{
 const rows=mergeAgents([],[pane('remote/t2')],[terminal('remote/t2')],spaces);
 expect(rows).toHaveLength(1);
 expect(rows[0]).toMatchObject({address:'remote/t2',status:'unknown',space:'remote/s1',tab_name:'contributor',app:'codex'});
});
test('real agent reports always win and are never duplicated',()=>{
 const real={address:'remote/t2',status:'working',app:'codex'};
 expect(mergeAgents([real],[pane('remote/t2','codex')],[terminal('remote/t2')],spaces)).toEqual([real]);
 expect(decoratePanes([pane('remote/t2','claude-code')],[terminal('remote/t2')])[0].app).toBe('claude-code');
});
test('removing a mark or closing the terminal removes its manual agent',()=>{
 expect(mergeAgents([],[pane('remote/t2')],[terminal('remote/t2',false)],spaces)).toEqual([]);
 expect(mergeAgents([],[pane('remote/t2')],[terminal('remote/t2',true,'finished')],spaces)).toEqual([]);
});

test('daemon status replaces unknown only while fresh and for the exact thread',()=>{
 const snapshot={at:1000,rows:{'remote/t2':{status:'working',threadId:'thread-1',source:'codex-app-server'}}};
 expect(mergeAgents([],[pane('remote/t2')],[terminal('remote/t2')],spaces,snapshot,2000)[0].status).toBe('working');
 expect(mergeAgents([],[pane('remote/t2')],[terminal('remote/t2')],spaces,snapshot,18000)[0].status).toBe('unknown');
 expect(mergeAgents([],[pane('remote/t3')],[terminal('remote/t3')],spaces,snapshot,2000)[0].status).toBe('unknown');
 const real={address:'remote/t2',status:'blocked',app:'codex'};
 expect(mergeAgents([real],[pane('remote/t2','codex')],[terminal('remote/t2')],spaces,snapshot,2000)).toEqual([real]);
});

const loginSource = (await readFile(new URL('../custom/agents/login.js',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replaceAll('export function ','function ');
function loginHarness(list:any[]) {
 const calls:any[]=[];
 const api=new Function('terminals','run','home',`${loginSource}; return {findLogin,openLogin};`)(()=>list,(...args:any[])=>calls.push(args),()=>'/Users/test');
 return {api,calls};
}
test('SSH login UI focuses an existing prompt only for the exact machine',()=>{
 const h=loginHarness([{state:'live',address:'t4',foreground:{argv:['hc','machine','login','vps1']}}]);
 h.api.openLogin({name:'vps1'});
 expect(h.calls).toEqual([['pane.focus',{terminal:'t4'}]]);
 expect(h.api.findLogin([{state:'live',address:'t4',foreground:{argv:['hc','machine','login','vps10']}}],'vps1')).toBeUndefined();
});
test('SSH login UI opens a local prompt and never mistakes a finished login shell for one',()=>{
 const h=loginHarness([{state:'live',address:'t4',argv:['hc','machine','login','vps1'],foreground:{argv:['zsh','-l']}}]);
 h.api.openLogin({name:'vps1'});
 expect(h.calls).toEqual([['space.new',{name:'SSH · vps1',folder:'/Users/test',machine:null,argv:['/Users/test/.local/bin/hc','machine','login','vps1']}]]);
});
