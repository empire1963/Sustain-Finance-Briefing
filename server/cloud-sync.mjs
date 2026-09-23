import { SOURCES, REFRESH_MS, MAX_PER_SOURCE } from './sources.mjs';
import { mergeArticles, canonicalUrl } from './feed.mjs';
import { readCache, saveSources, claimRefresh, releaseRefresh } from './store.mjs';
async function readState(db){const r=await db.prepare("SELECT payload, checked_at FROM collector_state WHERE id = 'cloud'").all();return r.results?.[0]?{...JSON.parse(r.results[0].payload),checkedAt:r.results[0].checked_at}:{};}
async function saveState(db,state,now){await db.prepare("INSERT INTO collector_state (id, payload, checked_at) VALUES ('cloud', ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at").bind(JSON.stringify(state),now).run();}
export function validateSnapshot(data,now=Date.now()){
  if(!data||!Array.isArray(data.rows)||data.rows.length>SOURCES.length||!data.collector)throw new Error('Invalid cloud snapshot');
  const ids=new Set();
  for(const row of data.rows){
    const source=SOURCES.find(s=>s.id===row.source_id);
    if(!source||ids.has(source.id)||!Array.isArray(row.articles)||row.articles.length>MAX_PER_SOURCE)throw new Error('Invalid cloud source');ids.add(source.id);
    for(const key of ['checked_at','fetched_at'])if(!Number.isSafeInteger(row[key])||row[key]<0||row[key]>now+60000)throw new Error('Invalid cloud timestamp');
    if(row.error!==null&&typeof row.error!=='string')throw new Error('Invalid source status');
    if(row.articles.some(a=>a.sourceId!==source.id||typeof a.headline!=='string'||typeof a.summary!=='string'||canonicalUrl(a.url,source)!==a.url))throw new Error('Invalid cloud article');
  }
  for(const key of ['last_started','last_finished','run_count'])if(!Number.isSafeInteger(data.collector[key])||data.collector[key]<0)throw new Error('Invalid collector status');
  return data;
}
export async function readJsonBounded(response){
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty snapshot');let size=0,parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000000)throw new Error('Snapshot exceeds size limit');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function syncCloud(env,now=Date.now(),fetcher=fetch){
  let state=await readState(env.DB);
  if(!state.checkedAt||now-state.checkedAt>=(state.connectionError?15000:60000)){
    const lease=await claimRefresh(env.DB,now,'cloud-sync');
    if(lease)try{
      const url=new URL(env.SUSTAIN_CLOUD_URL);if(url.protocol!=='https:')throw new Error('Cloud collection requires HTTPS');
      const response=await fetcher(url.href,{headers:{'X-Sustain-Reader':env.SUSTAIN_CLOUD_READ_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Cloud reader HTTP '+response.status);
      const data=validateSnapshot(await readJsonBounded(response),now);
      const old=new Map((await readCache(env.DB)).map(r=>[r.source_id,r]));
      await saveSources(env.DB,data.rows.map(row=>({...row,articles:mergeArticles(row.articles,old.get(row.source_id)?.articles||[],now)})));
      state={lastRunAt:data.collector.last_finished,lastStartedAt:data.collector.last_started,runCount:data.collector.run_count,runError:data.collector.last_error,responding:data.collector.successful_sources,total:data.collector.total_sources,connectionError:null};
      await saveState(env.DB,state,now);
    }catch(error){
      console.error('cloud_sync_unavailable',error.message);state={...state,connectionError:'The cloud news service could not be reached. Showing previously collected stories.'};await saveState(env.DB,state,now);
    }finally{await releaseRefresh(env.DB,lease,'cloud-sync');}
  }
  const status=state.connectionError?'unavailable':!state.lastRunAt?'waiting':state.runError||now-state.lastRunAt>REFRESH_MS+60000?'delayed':'ok';
  return {mode:'cloud',status,lastRunAt:state.lastRunAt?new Date(state.lastRunAt).toISOString():null,runCount:state.runCount||0,message:state.connectionError||state.runError||null};
}
