import { SOURCES, REFRESH_MS } from '../server/sources.mjs';
import { fetchSource } from '../server/news.mjs';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function tokenMatches(token,expected){
  if(typeof token!=='string'||token.length!==64||!expected)return false;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
  let different=digest.length^expected.length;for(let i=0;i<digest.length;i++)different|=digest.charCodeAt(i)^expected.charCodeAt(i);return different===0;
}
export function createHandler({database,readerHash,collectorHash,fetcher=fetch,clock=Date.now}){
  return async request=>{
    const path=new URL(request.url).pathname;
    const read=request.method==='GET'&&path.endsWith('/snapshot');
    const collect=request.method==='POST'&&path.endsWith('/collect');
    if(!read&&!collect)return json({error:'Not found'},404);
    const token=request.headers.get(read?'X-Sustain-Reader':'X-Sustain-Collector');
    if(!await tokenMatches(token,read?readerHash:collectorHash))return json({error:'Unauthorized'},401);
    let lease=null;
    try{
      if(read){const [rows,state]=await Promise.all([database('sustain_sources?select=source_id,articles,checked_at,fetched_at,error'),database('sustain_collector?id=eq.true&select=last_started,last_finished,last_error,successful_sources,total_sources,run_count')]);return json({rows,collector:state[0]||null});}
      const now=clock();lease=now+90000;
      const claimed=await database('sustain_collector?id=eq.true&lease_until=lt.'+now,'PATCH',{lease_until:lease,last_started:now,last_error:null},'return=representation');
      if(!claimed.length){lease=null;return json({inProgress:true},202);}
      const existing=await database('sustain_sources?select=source_id,articles,checked_at,fetched_at,error');
      const previous=new Map(existing.map(r=>[r.source_id,r]));
      const due=SOURCES.filter(s=>!previous.has(s.id)||now-previous.get(s.id).checked_at>=REFRESH_MS-30000||(previous.get(s.id).error&&now-previous.get(s.id).checked_at>=60000));
      const rows=[];
      for(let i=0;i<due.length;i+=6)rows.push(...await Promise.all(due.slice(i,i+6).map(s=>fetchSource(s,previous.get(s.id),now,fetcher))));
      if(rows.length)await database('sustain_sources?on_conflict=source_id','POST',rows,'resolution=merge-duplicates');
      for(const row of rows)previous.set(row.source_id,row);
      const successful=SOURCES.filter(s=>!previous.get(s.id)?.error&&previous.get(s.id)?.fetched_at).length;
      await database('sustain_collector?id=eq.true&lease_until=eq.'+lease,'PATCH',{lease_until:0,last_finished:clock(),last_error:null,successful_sources:successful,total_sources:SOURCES.length,run_count:Number(claimed[0].run_count)+1});
      lease=null;return json({checked:rows.length,responding:successful,sources:SOURCES.length});
    }catch(error){
      console.error('sustain_collector_failed',error.message);
      if(lease)await database('sustain_collector?id=eq.true&lease_until=eq.'+lease,'PATCH',{lease_until:0,last_error:'Collection did not finish; another attempt will run on schedule.'}).catch(()=>{});
      return json({error:'News collection is temporarily unavailable'},503);
    }
  };
}
