import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createReaderAuth, StaleSessionError} from '../dist/auth.js';

const userSession = (id = 'reader-a', token = 'token-a') => ({user: {id, email: id + '@example.test'}, access_token: token, expires_at: 4600});
const reply = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

function harness({initial = userSession(), publicNews = false, configStatus = 200, handler = async () => reply({ok:true}), signout} = {}) {
  let active = initial, listener, timerId = 0, configuration;
  const timers=new Map(),events=[],calls=[],sdkCalls=[];
  const emit=(event,next)=>{active=next;listener(event,next);};
  const client={auth:{
    onAuthStateChange(callback){listener=callback;return {data:{subscription:{unsubscribe(){listener=()=>{};}}}};},
    getSession:async()=>({data:{session:active},error:null}),
    refreshSession:async()=>{sdkCalls.push(['refresh']);emit('TOKEN_REFRESHED',userSession(active.user.id,'new-token'));return {data:{session:active},error:null};},
    signInWithPassword:async input=>{sdkCalls.push(['signin',input]);emit('SIGNED_IN',userSession());return {data:{session:active},error:null};},
    signUp:async input=>{sdkCalls.push(['signup',input]);return {data:{session:null},error:null};},
    signOut:async input=>{sdkCalls.push(['signout',input]);if(signout)return signout();emit('SIGNED_OUT',null);return {error:null};},
    resetPasswordForEmail:async(...input)=>{sdkCalls.push(['reset',...input]);return {error:null};},
    updateUser:async input=>{sdkCalls.push(['update',input]);return {data:{user:active?.user},error:null};},
  }};
  const auth=createReaderAuth({
    origin:'https://sustain.example.test',clock:()=>1000000,
    schedule(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},cancel(id){timers.delete(id);},
    clientFactory(url,key,options){configuration={url,key,options};return client;},
    fetchImpl:async(path,options)=>{
      calls.push({path,options});
      if(path==='/api/config')return reply({supabaseUrl:'https://project.example.test',supabasePublishableKey:'sb_publishable_example',publicNews},configStatus);
      return handler(path,options);
    },
    onChange(state,event){events.push({state,event});},
  });
  return {auth,client,emit,events,calls,sdkCalls,timers,get configuration(){return configuration;}};
}

test('initializes persisted, refreshing browser sessions from publishable config',async()=>{
  const h=harness();await h.auth.initialize();
  assert.deepEqual(h.configuration.options.auth,{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true});
  assert.equal(h.configuration.key,'sb_publishable_example');
  assert.equal(h.auth.snapshot().user.id,'reader-a');
  await h.auth.request('/api/news');
  const request=h.calls.at(-1);
  assert.equal(request.options.headers.Authorization,'Bearer token-a');
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.credentials,'omit');
  h.auth.dispose();
});

test('private guest requests stop before fetch; optional public news omits authorization',async()=>{
  const h=harness({initial:null,publicNews:true});await h.auth.initialize();
  assert.equal(h.auth.snapshot().publicNews,true);
  await assert.rejects(h.auth.request('/api/me'),error=>error.status===401);
  assert.equal(h.calls.length,1);
  await h.auth.request('/api/news',{requireAuth:false});
  assert.equal(h.calls.at(-1).options.headers.Authorization,undefined);
  h.auth.dispose();
});

test('unavailable config gives a stable error without creating a client',async()=>{
  const h=harness({configStatus:503});await h.auth.initialize();
  assert.equal(h.configuration,undefined);
  assert.equal(h.auth.snapshot().status,'unavailable');
  assert.equal(h.auth.snapshot().publicNews,false);
  await assert.rejects(h.auth.request('/api/news'),error=>error.status===503);
  assert.equal(h.calls.length,1);
  h.auth.dispose();
});

test('account change aborts requests and rejects an old response even if fetch ignores abort',async()=>{
  const pending=deferred();const started=deferred();
  const h=harness({handler:async()=>{started.resolve();return pending.promise;}});await h.auth.initialize();
  const request=h.auth.request('/api/me');await started.promise;
  const version=h.auth.snapshot().epoch;
  h.emit('SIGNED_IN',userSession('reader-b','token-b'));
  assert.equal(h.auth.isCurrent(version),false);
  assert.equal(h.calls.at(-1).options.signal.aborted,true);
  pending.resolve(reply({saved:['reader-a private story']}));
  await assert.rejects(request,StaleSessionError);
  assert.equal(h.auth.snapshot().user.id,'reader-b');
  h.auth.dispose();
});

test('signout clears identity immediately while revocation is pending',async()=>{
  const pending=deferred();const h=harness({signout:()=>pending.promise});await h.auth.initialize();
  const version=h.auth.snapshot().epoch;
  const operation=h.auth.signOut();
  assert.equal(h.auth.snapshot().user,null);
  assert.equal(h.auth.isCurrent(version),false);
  h.emit('TOKEN_REFRESHED',userSession());
  assert.equal(h.auth.snapshot().user,null);
  pending.resolve({error:null});await operation;
  assert.deepEqual(h.sdkCalls.at(-1),['signout',{scope:'local'}]);
  h.auth.dispose();
});

test('signout failure keeps personal identity cleared and exposes a retry status',async()=>{
  const h=harness({signout:async()=>({error:new Error('offline')})});await h.auth.initialize();
  await assert.rejects(h.auth.signOut(),/Retry signing out/);
  assert.equal(h.auth.snapshot().user,null);
  assert.equal(h.auth.snapshot().status,'signout_error');
  await assert.rejects(h.auth.signIn('reader@example.test','password'),/Finish signing out/);
  h.auth.dispose();
});

test('401 refreshes once and retries using the renewed token',async()=>{
  let count=0;const h=harness({handler:async()=>++count===1?reply({},401):reply({saved:[]})});await h.auth.initialize();
  await h.auth.request('/api/me');
  assert.equal(count,2);
  assert.equal(h.sdkCalls.filter(call=>call[0]==='refresh').length,1);
  assert.equal(h.calls.at(-1).options.headers.Authorization,'Bearer new-token');
  assert.equal(h.auth.snapshot().user.id,'reader-a');
  h.auth.dispose();
});

test('persistent 401 expires the session after a single retry',async()=>{
  let count=0;const h=harness({handler:async()=>{count+=1;return reply({},401);}});await h.auth.initialize();
  await assert.rejects(h.auth.request('/api/me'),error=>error.status===401);
  assert.equal(count,2);
  assert.equal(h.auth.snapshot().user,null);
  assert.equal(h.auth.snapshot().status,'expired');
  h.auth.dispose();
});

test('403 reports approval requirements without refreshing or retrying',async()=>{
  const h=harness({handler:async()=>reply({error:'Forbidden'},403)});await h.auth.initialize();
  await assert.rejects(h.auth.request('/api/news'),error=>error.status===403&&/approved by the site owner/.test(error.message));
  assert.equal(h.sdkCalls.length,0);
  assert.equal(h.calls.length,2);
  assert.equal(h.auth.snapshot().user.id,'reader-a');
  h.auth.dispose();
});

test('a failed refresh after 401 expires the session instead of repeating denied requests',async()=>{
  const h=harness({handler:async()=>reply({},401)});await h.auth.initialize();
  h.client.auth.refreshSession=async()=>{throw new Error('offline');};
  await assert.rejects(h.auth.request('/api/news'),error=>error.status===401);
  assert.equal(h.calls.length,2);assert.equal(h.auth.snapshot().status,'expired');
  h.auth.dispose();
});

test('a late save response cannot be applied after signout',async()=>{
  const pending=deferred(),started=deferred();
  const h=harness({handler:async()=>{started.resolve();return pending.promise;}});await h.auth.initialize();
  const request=h.auth.request('/api/saved',{method:'POST',body:{url:'https://publisher.example.test/story'}});await started.promise;
  assert.equal(h.calls.at(-1).options.headers.Authorization,'Bearer token-a');
  assert.deepEqual(JSON.parse(h.calls.at(-1).options.body),{url:'https://publisher.example.test/story'});
  await h.auth.signOut();pending.resolve(reply({article:{headline:'Private reading list'}}));
  await assert.rejects(request,StaleSessionError);
  h.auth.dispose();
});

test('session expiry clears identity; a later SDK token refresh restores it as a new epoch',async()=>{
  const h=harness();await h.auth.initialize();
  const version=h.auth.snapshot().epoch;
  const expiry=[...h.timers.values()].find(timer=>timer.ms===3600000);assert.ok(expiry);expiry.fn();
  assert.equal(h.auth.snapshot().status,'expired');assert.equal(h.auth.snapshot().user,null);
  h.emit('TOKEN_REFRESHED',userSession('reader-a','renewed'));
  assert.equal(h.auth.isCurrent(version),false);assert.equal(h.auth.snapshot().user.id,'reader-a');
  h.auth.dispose();
});

test('email auth and recovery use SDK methods and return to the same origin',async()=>{
  const h=harness({initial:null});await h.auth.initialize();
  const signedUp=await h.auth.signUp('reader@example.test','example-password');
  assert.equal(signedUp.session,null);
  assert.deepEqual(h.sdkCalls.at(-1),['signup',{email:'reader@example.test',password:'example-password',options:{emailRedirectTo:'https://sustain.example.test/'}}]);
  await h.auth.resetPassword('reader@example.test');
  assert.deepEqual(h.sdkCalls.at(-1),['reset','reader@example.test',{redirectTo:'https://sustain.example.test/'}]);
  h.emit('PASSWORD_RECOVERY',userSession());
  assert.equal(h.events.at(-1).event,'PASSWORD_RECOVERY');
  await h.auth.updatePassword('new-example-password');
  assert.deepEqual(h.sdkCalls.at(-1),['update',{password:'new-example-password'}]);
  h.auth.dispose();
});

test('a stale initialization error cannot clear a newer signed-in account',async()=>{
  const pending=deferred(),started=deferred(),h=harness();
  h.client.auth.getSession=()=>{started.resolve();return pending.promise;};
  const initialize=h.auth.initialize();await started.promise;
  h.emit('SIGNED_IN',userSession('reader-b','token-b'));
  pending.resolve({data:{session:null},error:new Error('Older restore request failed')});
  await initialize;assert.equal(h.auth.snapshot().user.id,'reader-b');
  h.auth.dispose();
});

// A deliberately small DOM contract fixture for app event wiring. It does not
// parse HTML, emulate layout, or claim to replace a browser/rendering check.
const appSource=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
const pageSource=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
function appFixture(handler=async()=>({saved:[],preferences:{topics:[],regions:[],sort:'impact',openBriefing:false}})){
  const nodes=new Map(),listeners=new Map(),timers=[],refreshers=[];
  const node=()=>({hidden:false,open:false,innerHTML:'',textContent:'',value:'',dataset:{},disabled:false,
    classList:{toggle(){},remove(){},add(){}},setAttribute(){},addEventListener(){},
    closest(){return {hidden:false};},querySelector(){return null;},
    replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});
  for(const match of pageSource.matchAll(/id="([^"]+)"/g))nodes.set(match[1],node());
  const containers=new Map([['.additional-filters',node()],['.sort-field',node()]]);
  const document={getElementById:id=>nodes.get(id)||null,querySelector:selector=>containers.get(selector)||null,querySelectorAll:()=>[],addEventListener(type,listener){listeners.set(type,listener);}};
  let epoch=0;
  const auth={initialize:async()=>{},isCurrent:version=>version===epoch,request:(...args)=>handler(...args)};
  const context=vm.createContext({document,window:{addEventListener(){}},Intl,URL,AbortController,TextEncoder,Blob,
    FormData:class{constructor(form){this.data=form.values;}get(key){return this.data[key]??null;}getAll(key){return this.data[key]??[];}has(key){return Object.hasOwn(this.data,key);}},
    StaleSessionError,createReaderAuth:()=>auth,
    createAutoRefresh:()=>{const timer={stopped:false,stop(){this.stopped=true;},run(){}};refreshers.push(timer);return timer;},
    sourceHealth:()=>({text:'Source status',failed:0,pending:0,overdue:0}),setTimeout:fn=>{timers.push(fn);return timers.length;},
    inject:()=>{}, // Mock Vercel Analytics inject function
  });
  vm.runInContext(appSource,context);
  const run=source=>vm.runInContext(source,context);
  function identity(id,version,{publicNews=false,event='SIGNED_IN'}={}){
    epoch=version;context.nextAuth={status:id?'signed_in':'signed_out',error:'',epoch:version,user:id?{id,email:id+'@example.test'}:null,publicNews,configured:true};
    context.authEvent=event;run('handleAuthChange(nextAuth,authEvent)');
  }
  return {nodes,listeners,timers,refreshers,context,run,identity};
}

test('app logout clears personal data, private news, pending saves, and open preferences',()=>{
  const app=appFixture();app.identity('reader-a',1);
  app.run("saved=[{headline:'Private saved story',url:'https://example.test/story'}];articles=[{headline:'Private feed'}];deadlines=[{title:'Private calendar'}];sourceStatus=[{id:'private'}];readerReady=true;loaded=true;preferences={topics:['ESG policy'],regions:['Africa'],sort:'impact',openBriefing:false};pendingSaves.add('private');openPreferences();");
  assert.equal(app.nodes.get('info-dialog').open,true);assert.match(app.nodes.get('dialog-content').innerHTML,/ESG policy/);
  app.identity(null,2,{event:'SIGNED_OUT'});
  assert.equal(app.run('saved.length+articles.length+deadlines.length+sourceStatus.length+pendingSaves.size'),0);
  assert.equal(app.run('readerReady||loaded||readerLoading||loading'),false);
  assert.equal(app.nodes.get('info-dialog').open,false);assert.equal(app.nodes.get('dialog-content').innerHTML,'');
  assert.equal(app.nodes.get('saved-count').textContent,'—');assert.match(app.nodes.get('feed').innerHTML,/Sign in with your email/);
});

test('app discards old news without clearing the new account’s loading state',async()=>{
  const old=deferred(),fresh=deferred();let count=0;
  const app=appFixture(()=>++count===1?old.promise:fresh.promise);app.identity('reader-a',1);
  const oldRequest=app.run('loadNews()');
  app.identity('reader-b',2);const newRequest=app.run('loadNews()');
  old.resolve({articles:[{headline:'Reader A'}],sources:[]});await oldRequest;
  assert.equal(app.run('articles.length'),0);assert.equal(app.run('loading'),true);
  fresh.resolve({articles:[],sources:[],deadlines:[]});await newRequest;
  assert.equal(app.run('loaded'),true);assert.equal(app.run('loading'),false);
  assert.equal(app.nodes.get('auth-status').textContent,'reader-b@example.test');
});

test('app discards preferences and saved-list reads completed after an account change',async()=>{
  const pending=deferred(),app=appFixture(()=>pending.promise);app.identity('reader-a',1);
  const request=app.run('loadReader()');app.identity('reader-b',2);
  pending.resolve({saved:[{headline:'Reader A secret'}],preferences:{topics:['ESG policy'],regions:['Africa'],sort:'impact',openBriefing:true}});await request;
  assert.equal(app.run('saved.length+preferences.topics.length+preferences.regions.length'),0);
  assert.equal(app.run('readerReady'),false);assert.equal(app.run('view'),'all');
});

test('app ignores an old save completion while keeping the new account’s same-URL save pending',async()=>{
  const old=deferred(),fresh=deferred();let count=0;
  const app=appFixture(()=>++count===1?old.promise:fresh.promise);app.identity('reader-a',1);app.run('readerReady=true;');
  app.context.saveButton={dataset:{save:'https://example.test/story',savedUrl:''}};
  const oldRequest=app.run('toggleSaved(saveButton)');
  app.identity('reader-b',2);app.run('readerReady=true;');const newRequest=app.run('toggleSaved(saveButton)');
  old.resolve({article:{url:'https://example.test/story',headline:'Reader A'}});await oldRequest;
  assert.equal(app.run('saved.length'),0);assert.equal(app.run('pendingSaves.size'),1);
  fresh.resolve({article:{url:'https://example.test/story',headline:'Reader B'}});await newRequest;
  assert.equal(app.run('saved[0].headline'),'Reader B');assert.equal(app.run('pendingSaves.size'),0);
});

test('app preferences submit cannot update another account after logout',async()=>{
  const pending=deferred(),app=appFixture(()=>pending.promise);app.identity('reader-a',1);
  const button={disabled:false,textContent:'Save preferences'};
  const form={id:'preferences-form',isConnected:true,values:{topics:['ESG policy'],regions:['Africa'],sort:'impact',openBriefing:true},querySelector:()=>button};
  const request=app.listeners.get('submit')({target:form,preventDefault(){}});
  app.identity('reader-b',2);
  pending.resolve({preferences:{topics:['ESG policy'],regions:['Africa'],sort:'impact',openBriefing:true}});await request;
  assert.equal(app.run('preferences.topics.length+preferences.regions.length'),0);
  assert.equal(app.nodes.get('reader-status').textContent,'');
});

test('app stops polling and shows an access message on 403',async()=>{
  const denied=Object.assign(new Error('This account does not have access.'),{status:403});
  const app=appFixture(async()=>{throw denied;});app.identity('reader-a',1);app.run('startNewsRefresh()');
  await app.run('loadNews()');
  assert.equal(app.refreshers.at(-1).stopped,true);assert.equal(app.run('autoRefresh'),null);
  assert.match(app.nodes.get('feed').innerHTML,/account does not have access/);
  assert.equal(app.run('loading'),false);assert.equal(app.nodes.get('refresh-button').textContent,'Refresh');
});
