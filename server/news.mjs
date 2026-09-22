import { SOURCES, REFRESH_MS } from './sources.mjs';
import { parseFeed, mergeArticles, deduplicate, classify } from './feed.mjs';
import { groupCoverage } from './assessment.mjs';
import { DEADLINES } from './deadlines.mjs';
import { readCache, claimRefresh, releaseRefresh, saveSources } from './store.mjs';
import { syncCloud } from './cloud-sync.mjs';

async function readBounded(response){const reader=response.body?.getReader();if(!reader)throw new Error('Empty response');const parts=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000)throw new Error('Feed too large');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return new TextDecoder().decode(bytes);}
export async function fetchSource(source,previous,now=Date.now(),fetcher=fetch){
  try{
    const response=await fetcher(source.url,{headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9','User-Agent':'SustainReader/2.0 (+public RSS reader)'},signal:AbortSignal.timeout(8000),redirect:'follow'});
    if(!response.ok)throw new Error('Publisher returned HTTP '+response.status);
    const parsed=parseFeed(await readBounded(response),source,now);
    return {source_id:source.id,articles:mergeArticles(parsed.articles,previous?.articles||[],now),checked_at:now,fetched_at:now,error:null};
  }catch(error){return {source_id:source.id,articles:mergeArticles([],previous?.articles||[],now),checked_at:now,fetched_at:previous?.fetched_at||0,error:error.name==='TimeoutError'||error.name==='AbortError'?'Publisher timed out':String(error.message).slice(0,100)};}
}
export async function refresh(db,now=Date.now(),fetcher=fetch){
  const lease=await claimRefresh(db,now);if(!lease)return {inProgress:true};
  try{
    const existing=await readCache(db);const previous=new Map(existing.map(r=>[r.source_id,r]));const due=SOURCES.filter(s=>!previous.has(s.id)||now-previous.get(s.id).checked_at>=REFRESH_MS);
    const rows=[];
    for(let start=0;start<due.length;start+=6)rows.push(...await Promise.all(due.slice(start,start+6).map(s=>fetchSource(s,previous.get(s.id),now,fetcher))));
    await saveSources(db,rows);return {inProgress:false};
  }finally{await releaseRefresh(db,lease);}
}
export function makePayload(rows,now=Date.now(),refreshing=false){
  const bySource=new Map(rows.map(r=>[r.source_id,r]));const enabled=new Set(SOURCES.map(s=>s.id));
  const articles=deduplicate(rows.filter(r=>enabled.has(r.source_id)).flatMap(r=>mergeArticles([],r.articles,now))).map(a=>({...a,...classify(a.headline,a.summary,SOURCES.find(s=>s.id===a.sourceId),now)})).sort((a,b)=>(b.published||'').localeCompare(a.published||''));
  const sources=SOURCES.map(s=>{const row=bySource.get(s.id);return {id:s.id,name:s.name,home:s.home,scope:s.scope,kind:s.kind,subscription:!!s.subscription,count:articles.filter(a=>a.sourceId===s.id).length,checkedAt:row?.checked_at?new Date(row.checked_at).toISOString():null,fetchedAt:row?.fetched_at?new Date(row.fetched_at).toISOString():null,latestArticle:row?.articles?.find(a=>a.published)?.published||null,status:!row?'pending':row.error?'unavailable':now-row.checked_at>REFRESH_MS+60000?'stale':'ok',error:row?.error||null};});
  const checked=rows.filter(r=>enabled.has(r.source_id)).map(r=>r.checked_at).filter(Boolean);
  return {articles:groupCoverage(articles),articleCount:articles.length,deadlines:DEADLINES,sources,checkedAt:checked.length?new Date(Math.min(...checked)).toISOString():null,refreshing,refreshIntervalMinutes:15,retentionDays:90,backgroundCollection:false,coverage:'Publisher RSS feeds. Updates on opening and every 15 minutes while open; no background collection when closed.',generatedAt:new Date(now).toISOString()};
}
export async function getNews(env,ctx,fetcher=fetch){
  if(!env.DB)throw new Error('News storage is unavailable');
  if(env.SUSTAIN_CLOUD_URL&&env.SUSTAIN_CLOUD_READ_TOKEN){
    const now=Date.now();const collector=await syncCloud(env,now,fetcher);
    const payload=makePayload(await readCache(env.DB),now);
    return {...payload,backgroundCollection:true,collector,coverage:'Cloud collection runs every 15 minutes, including when this site is closed. Selected public feeds; publisher availability and coverage vary.'};
  }
  let rows=await readCache(env.DB);const now=Date.now();const due=SOURCES.some(s=>{const r=rows.find(r=>r.source_id===s.id);return !r||now-r.checked_at>=REFRESH_MS;});
  if(due){
    // Wait for an actual publisher check before labelling any source as current.
    const result=await refresh(env.DB,now,fetcher);rows=await readCache(env.DB);
    return makePayload(rows,now,result.inProgress);
  }
  return makePayload(rows,now,false);
}
