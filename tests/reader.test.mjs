import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, groupCoverage } from '../server/assessment.mjs';
import { readerApi } from '../server/reader.mjs';
import { localDatabase } from '../scripts/local-db.mjs';
import { saveSources } from '../server/store.mjs';
import { parseFeed } from '../server/feed.mjs';
import { SOURCES } from '../server/sources.mjs';
const req=(path,method='GET',body,user='reader-a',origin='https://sustain.example')=>new Request('https://sustain.example/api/'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
test('personal data requires identity; rejects cross-origin and invalid preference writes',async()=>{
  const DB=localDatabase();try{
    assert.equal((await readerApi(req('me','GET',null,null),{DB})).status,401);
    assert.equal((await readerApi(req('preferences','PUT',{topics:[],regions:[],sort:'impact',openBriefing:true},'a','https://evil.example'),{DB})).status,403);
    assert.equal((await readerApi(req('preferences','PUT',{topics:['invalid'],regions:[],sort:'impact',openBriefing:true}),{DB})).status,400);
    assert.equal((await readerApi(req('preferences','PUT',{topics:[],regions:[],sort:'impact',openBriefing:true,userId:'b'}),{DB})).status,400);
  }finally{DB.close();}
});
test('preferences persist and remain isolated between readers',async()=>{
  const DB=localDatabase();try{
    const p={topics:['ESG policy'],regions:['Europe'],sort:'impact',openBriefing:true};
    assert.equal((await readerApi(req('preferences','PUT',p),{DB})).status,200);
    assert.deepEqual((await (await readerApi(req('me'),{DB})).json()).preferences,p);
    assert.equal((await (await readerApi(req('me','GET',null,'reader-b'),{DB})).json()).preferences.openBriefing,false);
  }finally{DB.close();}
});
test('saved stories are feed-backed, idempotent, persistent and scoped to their reader',async()=>{
  const DB=localDatabase();try{
    const source=SOURCES[0],url='https://www.esgtoday.com/test-story';
    const articles=parseFeed(`<rss><channel><item><title>Climate fund raises $2 billion</title><link>${url}</link><description>Investment supports green energy.</description></item></channel></rss>`,source).articles;
    await saveSources(DB,[{source_id:source.id,articles,checked_at:Date.now(),fetched_at:Date.now(),error:null}]);
    assert.equal((await readerApi(req('saved','POST',{url:'https://evil.example/'}),{DB})).status,404);
    for(let i=0;i<2;i++)assert.equal((await readerApi(req('saved','POST',{url}),{DB})).status,200);
    assert.equal((await (await readerApi(req('me'),{DB})).json()).saved.length,1);
    assert.equal((await (await readerApi(req('me','GET',null,'reader-b'),{DB})).json()).saved.length,0);
    await readerApi(req('saved','DELETE',{url},'reader-b'),{DB});
    assert.equal((await (await readerApi(req('me'),{DB})).json()).saved.length,1);
    await readerApi(req('saved','DELETE',{url}),{DB});
    assert.equal((await (await readerApi(req('me'),{DB})).json()).saved.length,0);
  }finally{DB.close();}
});
test('priority distinguishes intentions, completed funding, currencies and conditions',()=>{
  const rate=(headline,summary='')=>assess(headline,summary,'Green investment');
  assert.ok(rate('Fund targets $100 billion').score<rate('Fund disburses $100 million').score);
  assert.ok(rate('Fund raises ¥100 billion').score<rate('Fund raises $1 billion').score);
  assert.equal(rate('Fund secures $2 billion','Funding is subject to regulatory approval.').status,'Conditional / unconfirmed');
  assert.equal(rate('Fund plans up to €2 billion, including €500 million').brief.amount,'€2 billion');
  assert.notEqual(assess('EU does not approve climate disclosure rule','','ESG policy').status,'Policy decision reported');
});
test('related coverage keeps every link and separates policy stages or conflicting amounts',()=>{
  const a={id:'1',url:'https://one.test/a',headline:'EU adopts new climate disclosure rule for investment funds',published:'2026-09-17T12:00:00Z',source:'One',topic:'ESG policy',region:'Europe',status:'Policy decision reported',brief:{amount:'€2 billion'}};
  const b={...a,id:'2',url:'https://two.test/b',source:'Two'};
  const grouped=groupCoverage([a,b]);assert.equal(grouped.length,1);assert.equal(grouped[0].coverage.length,2);
  assert.equal(groupCoverage([a,{...b,status:'Proposal / consultation'}]).length,2);
  assert.equal(groupCoverage([a,{...b,brief:{amount:'€4 billion'}}]).length,2);
  assert.equal(groupCoverage([a,{...b,published:'2026-09-10T12:00:00Z'}]).length,2);
});
test('official RDF and nonstandard FCA dates parse without full article ingestion',()=>{
  const source={id:'fca',name:'FCA',home:'https://www.fca.org.uk/',hosts:['fca.org.uk'],focused:true,kind:'Official source'};
  const result=parseFeed('<rss><channel><item><title>Climate disclosure consultation</title><link>https://www.fca.org.uk/a</link><pubDate>Thursday, September 17, 2026 - 13:02</pubDate></item></channel></rss>',source,Date.UTC(2026,8,18));
  assert.equal(result.articles[0].datePrecision,'day');assert.match(result.articles[0].published,/^2026-09-17/);
  const rdf='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>Climate finance</title><link>https://www.fca.org.uk/b</link><dc:date>2026-09-17T00:00:00Z</dc:date></item></rdf:RDF>';
  assert.equal(parseFeed(rdf,source,Date.UTC(2026,8,18)).articles.length,1);
});
