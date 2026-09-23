import { configuration,createServices } from './services.mjs';
import { validateSnapshot,readJsonBounded } from '../server/cloud-sync.mjs';
import { makePayload } from '../server/news.mjs';
import { defaults,validatePreferences } from '../server/reader.mjs';

export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'}});
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function readBody(request){
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw fail(403,'This change must come from Sustain.');
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw fail(415,'JSON is required.');
  if(Number(request.headers.get('content-length'))>4096)throw fail(413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)throw fail(400,'A request body is required.');
  const parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw fail(413,'Request is too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail(400,'Invalid JSON.');}
}

export function createApp({env=process.env,services,clock=Date.now,fetcher=fetch}={}){
  let clients=services,cache=null,checkedAt=null,inFlight=null,lastFailure=false;
  async function readNews(config){
    const now=clock();
    if(!inFlight&&(checkedAt===null||now-checkedAt>=(lastFailure?15000:60000))){
      inFlight=(async()=>{
        try{
          let snapshot;
          // The existing authenticated collector endpoint is optional. Its durable
          // Supabase tables are the fallback when the Edge gateway has an outage.
          if(env.SUSTAIN_CLOUD_URL&&env.SUSTAIN_CLOUD_READ_TOKEN){
            try{const url=new URL(env.SUSTAIN_CLOUD_URL);if(url.protocol!=='https:')throw new Error('HTTPS required');const response=await fetcher(url,{headers:{'X-Sustain-Reader':env.SUSTAIN_CLOUD_READ_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Snapshot HTTP '+response.status);snapshot=validateSnapshot(await readJsonBounded(response),clock());}catch{snapshot=await clients.snapshot();}
          }else snapshot=await clients.snapshot();
          cache=validateSnapshot(snapshot,clock());lastFailure=false;
        }catch(error){lastFailure=true;if(!cache)throw fail(503,'The news collector is temporarily unavailable. Retrying shortly.');}
        finally{checkedAt=clock();inFlight=null;}
      })();
    }
    if(inFlight)await inFlight;
    if(!cache)throw fail(503,'The news collector is temporarily unavailable. Retrying shortly.');
    const payload=makePayload(cache.rows,clock());
    const state=cache.collector;
    const status=lastFailure?'unavailable':!state.last_finished?'waiting':state.last_error||clock()-state.last_finished>16*60000?'delayed':'ok';
    return {...payload,backgroundCollection:true,collector:{mode:'cloud',status,lastRunAt:state.last_finished?new Date(state.last_finished).toISOString():null,runCount:state.run_count,message:lastFailure?'Could not reach the collector. Showing the last loaded snapshot and retrying.':state.last_error||null},coverage:'Selected public feeds collected in Supabase approximately every 15 minutes, with automatic retries.'};
  }
  async function identify(request,config){
    const authorization=request.headers.get('authorization')||'';
    if(!/^Bearer [^\s]+$/i.test(authorization))throw fail(401,'Sign in to access your Sustain reading room.');
    const user=await clients.user(authorization.slice(7));
    if(!user?.id||!user.email||!user.email_confirmed_at)throw fail(401,'Please sign in with a verified email address.');
    if(!config.publicNews&&!config.allowedEmails.includes(user.email.toLowerCase()))throw fail(403,'This account does not have access to this private reading room.');
    return user.id;
  }
  return async function handle(request){
    try{
      const path=new URL(request.url).pathname;
      const methods={'/api/config':['GET'],'/api/news':['GET'],'/api/me':['GET'],'/api/preferences':['PUT'],'/api/saved':['POST','DELETE']};
      if(!methods[path])return json({error:'Not found.'},404);
      if(!methods[path].includes(request.method)){const response=json({error:'Method not allowed.'},405);response.headers.set('Allow',methods[path].join(', '));return response;}
      const config=configuration(env);
      if(path==='/api/config')return json({supabaseUrl:config.url,supabasePublishableKey:config.publishable,publicNews:config.publicNews});
      clients??=createServices(config,fetcher);
      const userId=path==='/api/news'&&config.publicNews?null:await identify(request,config);
      if(path==='/api/news')return json(await readNews(config));
      if(path==='/api/me'){const data=await clients.reader(userId);return json({preferences:data.preferences||defaults(),saved:data.saved});}
      const body=await readBody(request);
      if(path==='/api/preferences'){const preferences=validatePreferences(body);return json({preferences:await clients.preferences(userId,preferences)});}
      if(!body||typeof body.url!=='string'||body.url.length>2048||Object.keys(body).some(key=>key!=='url'))throw fail(400,'Choose a story from the feed.');
      if(request.method==='DELETE'){await clients.remove(userId,body.url);return json({removed:body.url});}
      const payload=await readNews(config);
      const article=payload.articles.find(a=>a.url===body.url||a.coverage?.some(c=>c.url===body.url));
      if(!article)throw fail(404,'This story is no longer in the feed. Refresh and try again.');
      return json({article:await clients.save(userId,article.url,article,clock())});
    }catch(error){
      if(error.code==='P0001'&&String(error.message).includes('saved_story_limit'))return json({error:'Your reading list holds 500 stories. Remove one before saving another.'},409);
      if(error.code==='P0002'&&String(error.message).includes('story_not_in_feed'))return json({error:'This story is no longer in the feed. Refresh and try again.'},404);
      if(!error.status)console.error('sustain_api_failed',error.code||error.name||'Error');
      return json({error:error.status?error.message:'Sustain is temporarily unavailable. Check the database setup and try again.'},error.status||503);
    }
  };
}
export const handle=createApp();
