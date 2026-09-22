import { readCache } from './store.mjs';
import { makePayload } from './news.mjs';
export const TOPICS=['ESG policy','Green investment','Transition finance','Nature finance','Carbon markets'];
export const REGIONS=['Global','Europe','Asia-Pacific','Africa','Americas'];
export const defaults=()=>({topics:[],regions:[],sort:'impact',openBriefing:false});
export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function validatePreferences(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['topics','regions','sort','openBriefing'].includes(k)))throw fail(400,'Invalid preferences.');
  for(const [key,choices] of [['topics',TOPICS],['regions',REGIONS]])if(!Array.isArray(value[key])||value[key].length>choices.length||value[key].some(v=>!choices.includes(v)))throw fail(400,'Choose valid topics and regions.');
  if(!['impact','newest'].includes(value.sort)||typeof value.openBriefing!=='boolean')throw fail(400,'Invalid briefing preferences.');
  return {...value,topics:[...new Set(value.topics)],regions:[...new Set(value.regions)]};
}
async function bodyJson(request){
  if(request.headers.get('Origin')!==new URL(request.url).origin)throw fail(403,'This change must come from Sustain.');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw fail(403,'This change must come from Sustain.');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail(415,'JSON is required.');
  if(Number(request.headers.get('Content-Length'))>4096)throw fail(413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)throw fail(400,'A request body is required.');
  let size=0,parts=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw fail(413,'Request is too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail(400,'Invalid JSON.');}
}
export async function readerApi(request,env){
  try{
    const user=request.headers.get('oai-authenticated-user-id');
    if(!user)return json({error:'Sign in with your ChatGPT account to save stories and preferences.'},401);
    if(!env.DB)throw fail(503,'Your reading list is temporarily unavailable.');
    const path=new URL(request.url).pathname;
    if(path==='/api/me'&&request.method==='GET'){
      const prefs=await env.DB.prepare('SELECT preferences FROM reader_preferences WHERE user_id = ?').bind(user).all();
      const saved=await env.DB.prepare('SELECT payload, saved_at FROM saved_stories WHERE user_id = ? ORDER BY saved_at DESC').bind(user).all();
      return json({preferences:prefs.results?.[0]?JSON.parse(prefs.results[0].preferences):defaults(),saved:(saved.results||[]).map(r=>({...JSON.parse(r.payload),savedAt:r.saved_at}))});
    }
    if(!((path==='/api/preferences'&&request.method==='PUT')||(path==='/api/saved'&&['POST','DELETE'].includes(request.method))))return json({error:'Method not allowed.'},405);
    const body=await bodyJson(request);
    if(path==='/api/preferences'){
      const preferences=validatePreferences(body);
      await env.DB.prepare('INSERT INTO reader_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences, updated_at = excluded.updated_at').bind(user,JSON.stringify(preferences),Date.now()).run();
      return json({preferences});
    }
    if(!body||typeof body.url!=='string'||body.url.length>2048||Object.keys(body).some(k=>k!=='url'))throw fail(400,'Choose a story from the feed.');
    if(request.method==='DELETE'){
      await env.DB.prepare('DELETE FROM saved_stories WHERE user_id = ? AND article_url = ?').bind(user,body.url).run();
      return json({removed:body.url});
    }
    const payload=makePayload(await readCache(env.DB));
    const article=payload.articles.find(a=>a.url===body.url||a.coverage.some(c=>c.url===body.url));
    if(!article)throw fail(404,'This story is no longer in the collected feed. Refresh and try again.');
    const savedAt=Date.now();
    const result=await env.DB.prepare('INSERT INTO saved_stories (user_id, article_url, payload, saved_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM saved_stories WHERE user_id = ?) < 500 OR EXISTS (SELECT 1 FROM saved_stories WHERE user_id = ? AND article_url = ?) ON CONFLICT(user_id, article_url) DO UPDATE SET payload = excluded.payload').bind(user,article.url,JSON.stringify(article),savedAt,user,user,article.url).run();
    if(!result.meta?.changes)throw fail(409,'Your reading list holds 500 stories. Remove one before saving another.');
    return json({article:{...article,savedAt}});
  }catch(error){if(!error.status)console.error('reader_unavailable',error.message);return json({error:error.status?error.message:'Your reading list is temporarily unavailable. Please try again.'},error.status||503);}
}
