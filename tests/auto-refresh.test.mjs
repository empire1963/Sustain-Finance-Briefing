import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRefresh } from '../dist/auto-refresh.js';
function harness(refresh=async()=>true){
  const doc=new EventTarget(),win=new EventTarget();doc.visibilityState='visible';win.navigator={onLine:true};
  let now=0,id=0,calls=0;const timers=new Map();
  const loop=createAutoRefresh({refresh:()=>{calls++;return refresh();},doc,win,clock:()=>now,schedule:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},cancel:id=>timers.delete(id)});
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return {doc,win,loop,timers,get calls(){return calls;},flush,async advance(ms){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}};
}
test('loads immediately and checks every minute without a manual action',async()=>{
  const h=harness();await h.flush();assert.equal(h.calls,1);await h.advance(59999);assert.equal(h.calls,1);await h.advance(1);assert.equal(h.calls,2);h.loop.stop();assert.equal(h.timers.size,0);
});
test('failed checks retry after 15 seconds and recover to the normal interval',async()=>{
  let ok=false;const h=harness(async()=>ok);await h.flush();await h.advance(15000);assert.equal(h.calls,2);ok=true;await h.advance(15000);assert.equal(h.calls,3);await h.advance(15000);assert.equal(h.calls,3);await h.advance(45000);assert.equal(h.calls,4);h.loop.stop();
});
test('returning from a hidden tab, page cache or offline state refreshes without overlapping requests',async()=>{
  const h=harness();await h.flush();h.doc.visibilityState='hidden';h.doc.dispatchEvent(new Event('visibilitychange'));await h.advance(60000);assert.equal(h.calls,1);
  h.doc.visibilityState='visible';h.doc.dispatchEvent(new Event('visibilitychange'));h.win.dispatchEvent(new Event('focus'));await h.flush();assert.equal(h.calls,2);
  h.win.navigator.onLine=false;h.win.dispatchEvent(new Event('offline'));await h.advance(60000);assert.equal(h.calls,2);
  h.win.navigator.onLine=true;h.win.dispatchEvent(new Event('online'));await h.flush();assert.equal(h.calls,3);
  await h.advance(10000);h.win.dispatchEvent(new Event('pageshow'));await h.flush();assert.equal(h.calls,4);h.loop.stop();
});
test('slow requests and manual refresh share one in-flight request',async()=>{
  let finish;const h=harness(()=>new Promise(r=>finish=r));await h.flush();h.loop.run();await h.advance(60000);h.win.dispatchEvent(new Event('focus'));await h.flush();assert.equal(h.calls,1);finish(true);await h.flush();await h.advance(60000);assert.equal(h.calls,2);h.loop.stop();finish(true);await h.flush();assert.equal(h.timers.size,0);
});
