import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler } from '../cloud/collector.mjs';
import { SOURCES } from '../server/sources.mjs';
import { parseFeed } from '../server/feed.mjs';
import { getNews } from '../server/news.mjs';
import { saveSources } from '../server/store.mjs';
import { localDatabase } from '../scripts/local-db.mjs';
const reader='a'.repeat(64),collector='b'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
const config={readerHash:hash(reader),collectorHash:hash(collector)};
const request=(path,token,method='GET')=>new Request('https://example.org/sustain-feed/'+path,{method,headers:{[method==='GET'?'X-Sustain-Reader':'X-Sustain-Collector']:token}});
function fixtureDatabase(){
  const state={id:true,lease_until:0,last_started:0,last_finished:0,last_error:null,successful_sources:0,total_sources:0,run_count:0};const rows=[];
  return {state,rows,async database(path,method='GET',body){
    if(path.startsWith('sustain_sources')){if(method==='GET')return structuredClone(rows);for(const r of body){const old=rows.findIndex(v=>v.source_id===r.source_id);if(old<0)rows.push(r);else rows[old]=r;}return [];}
    if(method==='GET')return [structuredClone(state)];
    const lease=path.match(/lease_until=(lt|eq)\.(\d+)/);
    if(lease&&(lease[1]==='lt'?state.lease_until>=Number(lease[2]):state.lease_until!==Number(lease[2])))return [];
    Object.assign(state,body);return [structuredClone(state)];
  }};
}
test('cloud endpoints authenticate every request and separate reader from collector',async()=>{
  let touched=false;const handler=createHandler({...config,database:()=>{touched=true;return [];}});
  assert.equal((await handler(request('snapshot','wrong'))).status,401);
  assert.equal((await handler(request('snapshot',collector))).status,401);
  assert.equal((await handler(request('collect',reader,'POST'))).status,401);
  assert.equal(touched,false);
});
test('cloud collection persists partial success, preserves last good data and coordinates concurrent calls',async()=>{
  const db=fixtureDatabase();const now=Date.now();let release;let startedResolve;
  const started=new Promise(r=>startedResolve=r),gate=new Promise(r=>release=r);
  db.rows.push({source_id:SOURCES[0].id,articles:[{url:'https://www.esgtoday.com/old',headline:'Earlier green investment',sourceId:SOURCES[0].id,published:new Date(now-86400000).toISOString()}],checked_at:now-3600000,fetched_at:now-3600000,error:null});
  let calls=0;const handler=createHandler({...config,database:db.database,clock:()=>now,fetcher:async()=>{calls++;startedResolve();await gate;return new Response('Unavailable',{status:503});}});
  const running=handler(request('collect',collector,'POST'));await started;
  assert.equal((await handler(request('collect',collector,'POST'))).status,202);release();
  assert.equal((await running).status,200);assert.equal(calls,SOURCES.length);
  assert.equal(db.rows[0].articles.length,1);assert.equal(db.rows[0].fetched_at,now-3600000);
  assert.equal(db.state.run_count,1);assert.equal(db.state.lease_until,0);
  const snapshot=await (await handler(request('snapshot',reader))).json();assert.equal(snapshot.rows.length,SOURCES.length);
});
test('cloud sync persists a snapshot and preserves local news on later connection failure',async()=>{
  const DB=localDatabase();try{
    const now=Date.now(),source=SOURCES[0];
    const articles=parseFeed('<rss><channel><item><title>Green fund raises $2 billion</title><link>https://www.esgtoday.com/new</link><description>Climate investment.</description></item></channel></rss>',source,now).articles;
    await saveSources(DB,[{source_id:source.id,articles:[{...articles[0],id:'https://www.esgtoday.com/old',url:'https://www.esgtoday.com/old',headline:'Earlier green fund'}],checked_at:now-3600000,fetched_at:now-3600000,error:null}]);
    const env={DB,SUSTAIN_CLOUD_URL:'https://example.org/snapshot',SUSTAIN_CLOUD_READ_TOKEN:reader};
    const fetcher=async(url,options)=>{assert.equal(options.headers['X-Sustain-Reader'],reader);assert.equal(options.redirect,'manual');return Response.json({rows:[{source_id:source.id,articles,checked_at:now,fetched_at:now,error:null}],collector:{last_started:now,last_finished:now,last_error:null,run_count:1,total_sources:17,successful_sources:17}});};
    const data=await getNews(env,{},fetcher);assert.equal(data.backgroundCollection,true);assert.equal(data.collector.status,'ok');assert.equal(data.articleCount,2);
    await DB.prepare('UPDATE collector_state SET checked_at = 0').run();
    const failed=await getNews(env,{},async()=>{throw new Error('Offline');});assert.equal(failed.collector.status,'unavailable');assert.equal(failed.articleCount,2);assert.ok(failed.collector.lastRunAt);
    const serialized=JSON.stringify(failed);assert.equal(serialized.includes(reader),false);
  }finally{DB.close();}
});
test('malformed cloud snapshots cannot replace cached news or claim a successful run',async()=>{
  const DB=localDatabase();try{
    const env={DB,SUSTAIN_CLOUD_URL:'https://example.org/snapshot',SUSTAIN_CLOUD_READ_TOKEN:reader};
    const result=await getNews(env,{},async()=>Response.json({rows:[],collector:{last_finished:'invented'}}));
    assert.equal(result.collector.status,'unavailable');assert.equal(result.collector.lastRunAt,null);
  }finally{DB.close();}
});

