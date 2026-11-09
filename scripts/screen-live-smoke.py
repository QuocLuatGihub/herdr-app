"""Headless GNU Screen regression: scroll away, return live, and verify no child input.
Run with HC_SESSION set and --machine naming a connected Linux test machine.
Creates and removes only uniquely named synthetic test terminals.
"""
import os,subprocess,json,time,pathlib,struct,select,argparse
parser=argparse.ArgumentParser()
parser.add_argument('--machine',required=True)
args=parser.parse_args()
if not os.environ.get('HC_SESSION'):
 parser.error('Set HC_SESSION to the core session containing your test machine')
ENV=dict(os.environ)
MACHINE=args.machine
NAME='hlive-'+format(os.getpid(),'x')+'-'+format(time.time_ns() & 0xffffffff,'x')
CONFIG='/tmp/'+NAME+'.screenrc'
INPUT='/tmp/'+NAME+'.input.json'
ROOT=pathlib.Path(__file__).resolve().parents[1]
def hc(*args):return subprocess.check_output(['hc',*args],env=ENV,text=True)
def remote(*args):return hc('exec','--on',MACHINE,*args)
def text(address):return json.loads(hc('read',address,'--json','--lines','0'))['text']
def raw(address,payload):
 p=subprocess.Popen(['hc','connect'],env=ENV,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
 try:
  p.stdin.write(b'{"id":0,"method":"hello","params":{"framed":true}}\n');p.stdin.flush()
  header=b''
  while not header.endswith(b'\n'):header+=os.read(p.stdout.fileno(),1)
  request=json.dumps({'id':1,'method':'terminal.attach','params':{'terminal':address,'cols':200,'rows':120}}).encode()
  p.stdin.write(struct.pack('<IBI',0,0,len(request))+request);p.stdin.flush()
  buffer=b'';deadline=time.monotonic()+4
  while time.monotonic()<deadline:
   if not select.select([p.stdout],[],[],.1)[0]:continue
   buffer+=os.read(p.stdout.fileno(),65536)
   while len(buffer)>=9:
    channel,kind,size=struct.unpack('<IBI',buffer[:9])
    if len(buffer)<size+9:break
    body,buffer=buffer[9:size+9],buffer[size+9:]
    if channel==0 and kind==0:
     reply=json.loads(body)
     if reply.get('id')==1:
      assert 'result' in reply,reply
      channel=reply['result']['channel'];p.stdin.write(struct.pack('<IBI',channel,0,len(payload))+payload);p.stdin.flush();return
  raise RuntimeError('No attachment')
 finally:p.terminate();p.wait(timeout=3)
server=view=None
try:
 remote('python3','-c','import pathlib,sys;pathlib.Path(sys.argv[1]).write_text(sys.argv[2])',CONFIG,'startup_message off\ndefscrollback 5000\n')
 program='''import os,tty,time,select,json,sys
p=sys.argv[1];tty.setraw(0);received=[];open(p,'w').write('[]')
for i in range(240):print('OLD HISTORY %03d'%i,end=chr(13)+chr(10),flush=True)
print('READY',end=chr(13)+chr(10),flush=True);end=time.monotonic()+90;last=time.monotonic();tick=0
while time.monotonic()<end:
 if select.select([0],[],[],.1)[0]:
  received.append(os.read(0,100).hex());open(p,'w').write(json.dumps(received))
 if time.monotonic()-last>=.5:
  tick+=1;last=time.monotonic();print('LIVE TICK %d'%tick,end=chr(13)+chr(10),flush=True)
'''
 server=json.loads(hc('run','--bg','--no-notify','--on',MACHINE,'--name',NAME+'-server','--','env','TERM=xterm-256color','screen','-c',CONFIG,'-S',NAME,'python3','-u','-c',program,INPUT))['address']
 deadline=time.monotonic()+15
 while 'READY' not in text(server):
  if time.monotonic()>deadline:raise RuntimeError('Fixture not ready: '+repr(text(server)[-500:]))
  time.sleep(.1)
 view=json.loads(hc('run','--bg','--no-notify','--on',MACHINE,'--name',NAME+'-view','--','env','TERM=xterm-256color','screen','-x',NAME))['address']
 time.sleep(.3)
 spec=json.loads(hc('get',view))
 configured=json.loads(remote('python3','-c',(ROOT/'custom/agents/screen_scroll.py').read_text(),json.dumps(spec)))
 assert configured['configured'],configured
 raw(view,b'\x1b[999;1~'*4)
 time.sleep(.3);frozen=text(view)
 time.sleep(1.2);assert text(view)==frozen,'History view unexpectedly followed output'
 raw(view,b'\x1b[999;2~'*3+b'\x1b[999;3~')
 time.sleep(.3);live=text(view)
 assert live!=frozen and 'LIVE TICK' in live,'Live output did not resume'
 raw(view,b'\x1b[999;3~'*3)
 time.sleep(.2)
 received=json.loads(remote('cat',INPUT));assert received==[],received
 assert json.loads(hc('get',server))['state']=='live'
 print(json.dumps({'history_froze':True,'new_output_resumed':True,'repeated_return_live_safe':True,'child_received':received,'task_still_running':True}))
finally:
 if server:
  subprocess.run(['hc','exec','--on',MACHINE,'screen','-S',NAME,'-X','quit'],env=ENV,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for address in (view,server):
  if address:subprocess.run(['hc','rm',address],env=ENV,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 remote('python3','-c','import os,sys\nfor p in sys.argv[1:]:\n try:os.unlink(p)\n except FileNotFoundError:pass',CONFIG,INPUT)
