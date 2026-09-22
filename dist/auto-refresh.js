export function createAutoRefresh({refresh,doc=document,win=window,clock=Date.now,schedule=setTimeout,cancel=clearTimeout,intervalMs=60000,retryMs=15000}){
  let timer=null,running=null,lastAttempt=-Infinity,stopped=false;
  const active=()=>!stopped&&doc.visibilityState==='visible'&&win.navigator?.onLine!==false;
  function clear(){if(timer!==null)cancel(timer);timer=null;}
  function plan(delay){clear();if(active())timer=schedule(()=>run(),delay);}
  function run(){
    if(running)return running;
    clear();if(!active())return Promise.resolve(false);
    lastAttempt=clock();
    running=Promise.resolve().then(refresh).catch(()=>false).then(ok=>{running=null;plan(ok===false?retryMs:intervalMs);return ok;});
    return running;
  }
  function resume(){if(!active()){clear();return;}if(clock()-lastAttempt>=5000)run();else if(!running)plan(5000-(clock()-lastAttempt));}
  doc.addEventListener('visibilitychange',resume);
  for(const event of ['focus','pageshow','online','offline'])win.addEventListener(event,resume);
  run();
  return {run,stop(){stopped=true;clear();doc.removeEventListener('visibilitychange',resume);for(const event of ['focus','pageshow','online','offline'])win.removeEventListener(event,resume);}};
}
