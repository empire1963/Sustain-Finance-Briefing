import { createAutoRefresh } from './auto-refresh.js';
import { sourceHealth } from './source-health.js';
let articles = [];
let sourceStatus = [];
let loaded = false;
let loading = false;
let loadError = '';
let visibleCount = 20;
let lastResponse = null;
let lastRequest = 0;
let view='all';
let deadlines=[];
let saved=[];
let preferences={topics:[],regions:[],sort:'impact',openBriefing:false};
let readerReady=false;
let readerLoading=true;
let viewChosen=false;
const pendingSaves=new Set();
const topics=['ESG policy','Green investment','Transition finance','Nature finance','Carbon markets'];
const regions=['Global','Europe','Asia-Pacific','Africa','Americas'];
const labels = {high:'High impact',watch:'Worth following',update:'General update'};
const ranks = {high:0,watch:1,update:2};
const state = {query:'',topic:'all',region:'all',impact:'all',source:'all',days:'30',sort:'newest'};
const byId = id => document.getElementById(id);
const escape = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'});
const timeFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const checkTimeFormat = new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const formatTime = value => value?timeFormat.format(new Date(value)):'Not yet checked';
const validUrl = value => {try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}};

function card(article,index) {
  const a=Object.fromEntries(Object.entries(article).map(([key,value])=>[key,escape(value)]));
  const importance=Object.hasOwn(labels,article.importance)?article.importance:'update';
  const date=article.published?`<time datetime="${a.published}">${dateFormat.format(new Date(article.published))}</time>`:'<span>Date not supplied</span>';
  const savedArticle=saved.find(s=>s.url===article.url||(s.coverage||[]).some(c=>(article.coverage||[{url:article.url}]).some(v=>v.url===c.url)));
  const coverage=article.coverage||[];
  return `<article class="story" aria-labelledby="story-title-${index}">
    <div class="story-top"><span class="impact-label ${importance}">${labels[importance]}</span><span class="topic-meta">${a.topic}</span></div>
    <h2 id="story-title-${index}">${a.headline}</h2>
    <div class="story-meta"><span class="source">${a.source}</span><span class="meta-divider" aria-hidden="true">/</span>${date}<span class="meta-divider" aria-hidden="true">/</span><span>${a.region}</span></div>
    <p class="story-summary">${a.summary||'This feed provides a headline only. Open the original source for the full story.'}</p>
    <div class="brief-facts"><span><strong>Stage</strong>${escape(article.brief?.stage||article.status)}</span>${article.brief?.amount?`<span><strong>Amount mentioned</strong>${escape(article.brief.amount)}</span>`:''}</div>
    ${article.brief?.qualification?`<p class="qualification">${escape(article.brief.qualification)}</p>`:''}
    <div class="why-matters"><span>Reading context</span><p>${a.whyItMatters}</p></div>
    <div class="story-bottom"><a href="${escape(validUrl(article.url))}" target="_blank" rel="noopener noreferrer" aria-label="${a.linkLabel} for ${a.headline} (opens in a new tab)">${a.linkLabel}<span aria-hidden="true">↗</span></a><span class="status">${a.status}</span></div>
    ${coverage.length>1?`<details class="related-coverage"><summary>${coverage.length} reports · related coverage</summary><p>Matched by similar headlines, stage, region and timing. Reports may share the same announcement.</p>${coverage.map(c=>`<a href="${escape(validUrl(c.url))}" target="_blank" rel="noopener noreferrer">${escape(c.source)}: ${escape(c.headline)} ↗${c.subscription?' <small>(subscription may be required)</small>':''}</a>`).join('')}</details>`:''}
    <details class="rating-reason"><summary>Why this rating?</summary><p>${a.importanceReason} This automatic assessment uses the headline and publisher excerpt. Verify details in the original; it is not investment advice.</p></details>
    <div class="save-row"><p class="ai-label">${a.summaryType} · Automatic priority${article.sourceKind==='Official source'?' · Official source':''}${article.subscription?' · Full article may require a subscription':''}</p><button class="save-button" data-save="${a.url}" data-saved-url="${escape(savedArticle?.url||'')}" aria-pressed="${!!savedArticle}" ${pendingSaves.has(article.url)?'disabled':''}>${pendingSaves.has(article.url)?'Saving…':savedArticle?'Saved ✓':'Save story'}</button></div>
  </article>`;
}
function matchesInterests(a){return (!preferences.topics.length||preferences.topics.includes(a.topic))&&(!preferences.regions.length||a.regions.some(r=>preferences.regions.includes(r)));}
function readingPool(){
  if(view==='saved')return saved;
  if(view==='briefing')return articles.filter(a=>a.published&&Date.parse(a.published)>=Date.now()-86400000&&matchesInterests(a)).sort((a,b)=>(b.score||0)-(a.score||0)||(b.published||'').localeCompare(a.published||'')).slice(0,10);
  return articles;
}
function filteredArticles(){
  const words=state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const since=Date.now()-Number(state.days)*86400000;
  return readingPool().filter(a=>(state.topic==='all'||a.topic===state.topic)&&(state.region==='all'||a.regions.includes(state.region))&&(state.impact==='all'||a.importance===state.impact)&&(state.source==='all'||a.sourceId===state.source||a.coverage?.some(c=>c.sourceId===state.source))&&(view==='saved'||!a.published||Date.parse(a.published)>=since)&&words.every(word=>[a.headline,a.summary,a.source,...(a.coverage||[]).map(c=>c.source),a.topic,a.region,a.whyItMatters,a.status].join(' ').toLocaleLowerCase().includes(word))).sort((a,b)=>state.sort==='impact'?(b.score||0)-(a.score||0)||ranks[a.importance]-ranks[b.importance]||(b.published||'').localeCompare(a.published||''):(b.published||'').localeCompare(a.published||''));
}
function render(){
  renderView();
  if(view==='calendar'){renderCalendar();return;}
  const filtered=filteredArticles();
  byId('result-count').innerHTML=loaded||view==='saved'?`<strong>${filtered.length}</strong> ${view==='saved'?'saved stories':view==='briefing'?'stories in your briefing':'matching · '+articles.length+' story groups'}`:'Connecting to publishers…';
  if(view==='saved'&&!readerReady)byId('feed').innerHTML=`<div class="empty"><h2>${readerLoading?'Loading your reading list.':'Your reading list could not be loaded.'}</h2><p>Sign in to access stories saved to your account.</p><button data-reader-retry>Try again</button></div>`;
  else if(view==='saved'&&!saved.length)byId('feed').innerHTML='<div class="empty"><h2>A place for stories worth keeping.</h2><p>Choose “Save story” on any article. Your list follows your account across devices.</p><button data-view="all">Browse news</button></div>';
  else if(view==='briefing'&&loaded&&!readingPool().length)byId('feed').innerHTML='<div class="empty"><h2>No recent stories match your interests.</h2><p>The briefing uses the past 24 hours of collected news. Broaden your interests or browse the full feed.</p><button data-preferences>Change interests</button><button data-view="all">All news</button></div>';
  else if(view!=='saved'&&!loaded&&loading)byId('feed').innerHTML='<div class="empty loading-state"><span class="section-kicker">CONNECTING TO YOUR SOURCES</span><h2>Fetching the latest stories.</h2><p>The first check can take a few seconds.</p></div>';
  else if(view!=='saved'&&!loaded&&loadError)byId('feed').innerHTML='<div class="empty"><h2>We couldn’t load the news.</h2><p>Your connection or the news service may be temporarily unavailable.</p><button data-refresh>Try again</button></div>';
  else if(view!=='saved'&&!articles.length)byId('feed').innerHTML='<div class="empty"><h2>No stories available yet.</h2><p>Check source status to see whether publishers are responding. This feed never fills gaps with sample stories.</p><button data-sources>View source status</button></div>';
  else byId('feed').innerHTML=filtered.length?filtered.slice(0,visibleCount).map(card).join(''):'<div class="empty"><span class="section-kicker">A DIFFERENT ANGLE</span><h2>No stories match these filters.</h2><p>Try a different source or time period, a broader region, or fewer search words.</p><button data-reset>Clear all filters</button></div>';
  byId('show-more').hidden=filtered.length<=visibleCount;
  byId('show-more').textContent='Show more stories ('+Math.max(0,filtered.length-visibleCount)+' remaining)';
  document.querySelectorAll('[data-topic]').forEach(b=>{const active=b.dataset.topic===state.topic;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-impact]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.impact===state.impact)));
  const filters=['topic','region','impact','source'].filter(key=>state[key]!=='all');
  const panel=byId('active-filters');panel.hidden=!filters.length&&!state.query;
  const filterLabel=key=>key==='impact'?labels[state[key]]:key==='source'?sourceStatus.find(s=>s.id===state.source)?.name||state.source:state[key];
  panel.innerHTML=filters.map(key=>`<button class="filter-chip" data-clear="${key}" aria-label="Remove ${escape(filterLabel(key))} filter">${escape(filterLabel(key))} <span aria-hidden="true">×</span></button>`).join('')+(state.query?`<span>Search: “${escape(state.query)}”</span>`:'')+'<button class="clear-button" data-reset>Clear all</button>';
}
function syncControls(){for(const key of ['region','sort','source','days','impact'])byId(key).value=state[key];byId('search').value=state.query;}
function setView(value){
  if(!['all','briefing','saved','calendar'].includes(value))return;
  viewChosen=true;view=value;Object.assign(state,{query:'',topic:'all',region:'all',impact:'all',source:'all',days:'30',sort:value==='briefing'?'impact':preferences.sort});visibleCount=20;syncControls();render();
}
function renderView(){
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  byId('saved-count').textContent=readerReady?saved.length:'—';
  document.querySelector('.additional-filters').hidden=view==='calendar';
  byId('topics').hidden=view==='calendar';
  byId('days').closest('label').hidden=view==='saved';
  document.querySelector('.sort-field').hidden=view==='calendar';
  const intro=byId('view-intro');intro.hidden=view==='all';
  if(view==='briefing')intro.innerHTML='<span class="section-kicker">YOUR DAILY READ</span><h2>The developments to start with.</h2><p>Up to 10 stories from the past 24 hours, selected by importance and your interests. Updated when you visit; no email is sent.</p><button data-preferences>Adjust my interests</button>';
  if(view==='saved')intro.innerHTML='<span class="section-kicker">YOUR READING LIST</span><h2>Keep the stories that matter to you.</h2><p>Saved to your account across devices. The excerpt and assessment are a snapshot from when you saved the story; check the source for later changes.</p>';
  if(view==='calendar')intro.innerHTML='<span class="section-kicker">WHAT COMES NEXT</span><h2>Policy dates, with the detail that matters.</h2><p>A selected calendar checked against official sources on 17 September 2026. Dates and scope may change; follow the source before acting. This is not a complete compliance calendar.</p>';
}
function renderCalendar(){
  const words=state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const current=new Date();const today=[current.getFullYear(),String(current.getMonth()+1).padStart(2,'0'),String(current.getDate()).padStart(2,'0')].join('-');
  const items=deadlines.filter(d=>d.date>=today&&(state.region==='all'||d.region===state.region)&&words.every(w=>[d.title,d.scope,d.jurisdiction,d.stage].join(' ').toLowerCase().includes(w)));
  byId('result-count').textContent=items.length+' upcoming policy dates';
  byId('show-more').hidden=true;byId('active-filters').hidden=true;
  byId('feed').innerHTML=items.map(d=>`<article class="story deadline"><div class="deadline-date"><time datetime="${escape(d.date)}">${escape(dateFormat.format(new Date(d.date+'T12:00:00')))}</time><span>${escape(d.jurisdiction)}</span></div><h2>${escape(d.title)}</h2><span class="status">${escape(d.stage)}</span><p class="story-summary">${escape(d.scope)}</p><div class="story-bottom"><a href="${escape(validUrl(d.url))}" target="_blank" rel="noopener noreferrer">${escape(d.source)} ↗</a><button class="save-button" data-calendar="${escape(d.id)}">Add to calendar</button></div><p class="ai-label">Verified ${escape(d.verifiedAt)} · Date only; check the source for timing and changes.</p></article>`).join('')||'<div class="empty"><h2>No upcoming dates match.</h2><p>Try another search or region. The calendar contains selected milestones only.</p></div>';
}
async function api(path,method='GET',body){
  const response=await fetch(path,{method,cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'This change could not be saved.');return data;
}
function readerNotice(message,error=false){byId('reader-status').textContent=message;byId('reader-status').classList.toggle('status-error',error);}
async function loadReader(){
  readerLoading=true;
  try{const data=await api('/api/me');saved=data.saved;preferences=data.preferences;readerReady=true;readerNotice('');if(!viewChosen){view=preferences.openBriefing?'briefing':'all';state.sort=preferences.sort;syncControls();}}
  catch(error){readerNotice(error.message,true);}
  finally{readerLoading=false;render();}
}
async function toggleSaved(button){
  if(!readerReady){readerNotice('Your reading list is unavailable. Use My interests to reconnect.',true);return;}
  const url=button.dataset.save;if(pendingSaves.has(url))return;pendingSaves.add(url);button.disabled=true;button.textContent='Saving…';
  try{
    if(button.dataset.savedUrl){await api('/api/saved','DELETE',{url:button.dataset.savedUrl});saved=saved.filter(s=>s.url!==button.dataset.savedUrl);readerNotice('Removed from your reading list.');}
    else{const data=await api('/api/saved','POST',{url});saved=[data.article,...saved.filter(s=>s.url!==data.article.url)];readerNotice('Story saved to your account.');}
  }catch(error){readerNotice(error.message,true);}
  finally{pendingSaves.delete(url);render();}
}
function openPreferences(){
  byId('dialog-title').textContent='Make Sustain yours.';
  byId('dialog-content').innerHTML=!readerReady?'<p>Your preferences could not be loaded. Sign in with your ChatGPT account and try again.</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a><button class="primary-button" data-reader-retry>Try again</button>':`<p>Choose what belongs in your daily briefing. Leave a group empty to include everything. All news stays available in the full feed.</p><form id="preferences-form"><fieldset><legend>Topics</legend>${topics.map(t=>`<label class="check-label"><input type="checkbox" name="topics" value="${escape(t)}" ${preferences.topics.includes(t)?'checked':''}> ${escape(t)}</label>`).join('')}</fieldset><fieldset><legend>Regions</legend>${regions.map(r=>`<label class="check-label"><input type="checkbox" name="regions" value="${escape(r)}" ${preferences.regions.includes(r)?'checked':''}> ${escape(r)}</label>`).join('')}</fieldset><label class="preference-sort">Default sort<select name="sort"><option value="impact" ${preferences.sort==='impact'?'selected':''}>Importance first</option><option value="newest" ${preferences.sort==='newest'?'selected':''}>Newest first</option></select></label><label class="check-label"><input type="checkbox" name="openBriefing" ${preferences.openBriefing?'checked':''}> Open Sustain with my daily briefing</label><p class="preference-note">Your choices and saved stories follow your account. The briefing appears here in Sustain; email delivery is not enabled.</p><p id="preferences-error" class="status-error" role="status"></p><button class="primary-button" type="submit">Save preferences</button></form>`;
  if(!byId('info-dialog').open)byId('info-dialog').showModal();
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='preferences-form')return;event.preventDefault();const form=event.target;const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Saving…';
  const data=new FormData(form);const next={topics:data.getAll('topics'),regions:data.getAll('regions'),sort:data.get('sort'),openBriefing:data.has('openBriefing')};
  try{const result=await api('/api/preferences','PUT',next);preferences=result.preferences;state.sort=preferences.sort;syncControls();byId('info-dialog').close();readerNotice('Your preferences are saved.');render();}
  catch(error){byId('preferences-error').textContent=error.message;}
  finally{button.disabled=false;button.textContent='Save preferences';}
});
function exportDeadline(id){
  const d=deadlines.find(d=>d.id===id);if(!d)return;
  const clean=s=>s.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  const next=new Date(d.date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sustain//Policy dates//EN','BEGIN:VEVENT','UID:'+d.id+'@sustain-finance','DTSTAMP:'+new Date().toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d+Z/,'Z'),'DTSTART;VALUE=DATE:'+d.date.replaceAll('-',''),'DTEND;VALUE=DATE:'+next.toISOString().slice(0,10).replaceAll('-',''),'SUMMARY:'+clean(d.title),'DESCRIPTION:'+clean(d.scope+'\n'+d.stage+'\nVerified '+d.verifiedAt+'. Check official source for changes.\n'+d.url),'URL:'+d.url,'END:VEVENT','END:VCALENDAR'];
  // Fold by UTF-8 octets for Apple Calendar and other RFC 5545 readers.
  const folded=lines.map(line=>{let out='',part='',bytes=0;for(const c of line){const n=new TextEncoder().encode(c).length;if(bytes+n>73){out+=part+'\r\n ';part='';bytes=1;}part+=c;bytes+=n;}return out+part;}).join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([folded],{type:'text/calendar;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=d.id+'.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);readerNotice('Calendar file downloaded. Add it to your calendar and check the official source for changes.');
}
function reset(){Object.assign(state,{query:'',topic:'all',region:'all',impact:'all',source:'all',days:'90'});visibleCount=20;syncControls();render();}
function updateStatus(){
  const health=sourceHealth(sourceStatus);
  byId('source-count').textContent=health.text;
  byId('checked-at').textContent=lastResponse?.checkedAt?'Sources last checked '+formatTime(lastResponse.checkedAt):'Waiting for the first publisher check';
  const collector=lastResponse?.collector;
  const lastCollection=collector?.lastRunAt?' Last completed '+formatTime(collector.lastRunAt)+'.':'';
  const cloudMessage=collector?(collector.status==='ok'?'Cloud collection runs every 15 minutes, even when this site is closed.':collector.status==='waiting'?'Waiting for the first completed collection.':collector.status==='delayed'?'News collection is overdue. The collector retries automatically; showing the last collected stories.':collector.message||'Could not connect to the news collector. Retrying automatically.')+lastCollection+(health.failed?` ${health.failed} publisher${health.failed===1?'':'s'} failed their last check.`:'')+(health.pending?' Some publishers have not been checked yet.':''):null;
  const pageCheck=lastRequest?' Page checked '+checkTimeFormat.format(new Date(lastRequest))+'.':'';
  byId('refresh-status').textContent=(loadError||cloudMessage||(lastResponse?.refreshing?'Another feed check is in progress. Checking again shortly.':sourceStatus.some(s=>s.status!=='ok')?'Some feeds are unavailable or awaiting a check. Previously collected stories are retained.':'Publisher summaries and source links.'))+pageCheck+' Auto-refresh checks every minute and when you return; failed checks retry shortly.';
  byId('refresh-status').classList.toggle('status-error',!!loadError||health.overdue>0||health.failed>0||!!collector&&['delayed','unavailable'].includes(collector.status));
  byId('refresh-button').disabled=loading;byId('refresh-button').textContent=loading?'Checking…':'Refresh';
}
async function loadNews(){
  if(loading)return false;loading=true;loadError='';updateStatus();if(!loaded)render();
  try{
    const response=await fetch('/api/news',{cache:'no-store',signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw new Error('News service unavailable');
    const data=await response.json();if(!Array.isArray(data.articles)||!Array.isArray(data.sources))throw new Error('Invalid feed response');
    const changed=!loaded||JSON.stringify(articles)!==JSON.stringify(data.articles)||JSON.stringify(deadlines)!==JSON.stringify(data.deadlines||[]);
    articles=data.articles;deadlines=data.deadlines||[];sourceStatus=data.sources;lastResponse=data;loaded=true;lastRequest=Date.now();
    byId('source').innerHTML='<option value="all">All sources</option>'+sourceStatus.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
    byId('source').value=state.source;if(changed||view==='briefing')render();
    return !data.refreshing&&(!data.collector||data.collector.status==='ok');
  }catch{loadError=loaded?'The latest check failed. Keeping your stories and retrying automatically.':'News could not be loaded. Retrying automatically when connected.';if(!loaded)render();return false;}
  finally{loading=false;updateStatus();if(!loaded)render();}
}
const content={
  about:{title:'Your sustainable-finance reading room.',html:'<p>Sustain collects public publisher feeds covering sustainable investment, ESG policy, transition finance, carbon markets and nature finance.</p><p><strong>The published site collects news in the cloud every 15 minutes, even when your devices are off.</strong> The page shows the last completed collection and warns if the cloud service is delayed or unreachable. Refresh loads the latest collected snapshot; it does not force every publisher to update. Publishers choose how many recent items their feeds provide, so this is not an exhaustive archive or every sustainable-finance story.</p><p>Collected articles are retained for up to 90 days, with a limit of 100 per source. Search and filters apply to that collected set. “Global” means international scope or a location that could not be established from the feed. Some stories have multiple region tags.</p><p><strong>Summaries are short publisher-provided excerpts, not AI-written full-article summaries.</strong> When a publisher supplies only a headline, we say so. We do not bypass paywalls or reproduce full articles. Publication dates are supplied by the source; missing dates remain labelled.</p><p>Priority labels, topic and region tags are inferred automatically. Reading context gives general topic context rather than a claim about a specific transaction. Follow the original source to verify detail, publication status and later changes.</p><p>Your saved stories and preferences are stored with your signed-in account. Your daily briefing selects up to ten collected stories from the past 24 hours; it appears in the site, with no email delivery. Similar reports are grouped conservatively and retain every original link. The policy calendar contains selected official dates verified on 17 September 2026; it is not automatically re-verified. Calendar downloads are snapshots and do not update themselves. This site stays private to your account. Publisher websites have their own access conditions.</p>'},
  method:{title:'A reason behind every rating.',html:'<p>Ratings are automatic reading priority from the headline and short publisher excerpt. They are not a full-article review, a reliability score or an investment recommendation.</p><ul><li><strong>High impact:</strong> 50 or more points across the reported stage, scope and financing amount.</li><li><strong>Worth following:</strong> 25–49 points, or a policy story or proposal needing attention.</li><li><strong>General update:</strong> fewer signals in the available text. It may still matter to you.</li></ul><p>Expand “Why this rating?” for the contributions. Decisions and reversals receive up to 35 points; completed financing 30; commitments 25; proposals 15; intentions 8. Named national scope adds 15 or cross-border scope 20.</p><p>Explicit USD, EUR or GBP amounts add 10 points from 100 million, 20 from one billion or 25 from ten billion. These are rough bands without currency conversion. Targets, proposals and conditional amounts receive at most 8 scale points. Other currencies add no scale points. Only the first amount is considered; figures are not added together.</p><p>Stage labels and amount signals can miss context. A government rejection can matter as much as an approval. Similar reports are grouped conservatively, without boosting the score for repeated coverage. Verify legal status, amounts and dates in the original source.</p>'}
};
function sourcesHtml(){
  return '<p>'+escape(lastResponse?.coverage||'Selected public publisher feeds.')+' A responding feed may still have an old latest article. Counts refer to collected, relevant stories.</p><div class="source-list">'+sourceStatus.map(s=>{
    const latest=s.latestArticle?dateFormat.format(new Date(s.latestArticle)):'No dated story collected';
    return `<section class="source-status"><div><a href="${escape(validUrl(s.home))}" target="_blank" rel="noopener noreferrer">${escape(s.name)} ↗</a><span class="health ${s.status==='ok'?'healthy':'degraded'}">${s.status==='ok'?'Responding':s.status==='unavailable'?'Unavailable':s.status==='stale'?'Check due':'Awaiting check'}</span></div><p>${escape(s.scope)} · ${escape(s.kind)}</p><p>${s.count} stories · Latest: ${escape(latest)}</p><p>Last attempt: ${escape(formatTime(s.checkedAt))}<br>Last successful fetch: ${escape(formatTime(s.fetchedAt))}</p>${s.error?'<p class="status-error">Could not fetch this publisher. Previously collected articles are kept.</p>':''}${s.subscription?'<p>Full articles may require a publisher subscription.</p>':''}</section>`;
  }).join('')+'</div><p>Feeds supply selected recent items. Availability does not imply complete market, geographic or publisher coverage.</p>';
}
function openInfo(type){
  const info=type==='sources'?{title:'Sources & coverage',html:sourceStatus.length?sourcesHtml():'<p>Sources are still loading. Please try again shortly.</p>'}:content[type];
  byId('dialog-title').textContent=info.title;byId('dialog-content').innerHTML=info.html;byId('info-dialog').showModal();
}
byId('search').addEventListener('input',event=>{state.query=event.target.value;visibleCount=20;render();});
for(const key of ['region','sort','source','days','impact'])byId(key).addEventListener('change',event=>{state[key]=event.target.value;visibleCount=20;render();});
byId('show-more').addEventListener('click',()=>{visibleCount+=20;render();});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.view)setView(target.dataset.view);
  if(target.hasAttribute('data-preferences'))openPreferences();
  if(target.hasAttribute('data-save'))toggleSaved(target);
  if(target.dataset.calendar)exportDeadline(target.dataset.calendar);
  if(target.hasAttribute('data-reader-retry'))loadReader().then(()=>{if(byId('info-dialog').open)openPreferences();});
  if(target.dataset.topic){state.topic=target.dataset.topic;visibleCount=20;render();}
  if(target.dataset.impact){state.impact=state.impact===target.dataset.impact?'all':target.dataset.impact;byId('impact').value=state.impact;visibleCount=20;render();byId('news').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  if(target.hasAttribute('data-reset'))reset();
  if(target.dataset.clear){state[target.dataset.clear]='all';syncControls();render();}
  if(target.hasAttribute('data-about'))openInfo('about');
  if(target.hasAttribute('data-method'))openInfo('method');
  if(target.hasAttribute('data-sources'))openInfo('sources');
  if(target.hasAttribute('data-refresh'))autoRefresh.run();
});
byId('close-dialog').addEventListener('click',()=>byId('info-dialog').close());
byId('info-dialog').addEventListener('click',event=>{if(event.target===byId('info-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
syncControls();
const autoRefresh=createAutoRefresh({refresh:loadNews});
loadReader();

if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  const choices={topic:['all','ESG policy','Green investment','Transition finance','Nature finance','Carbon markets'],region:['all','Global','Europe','Asia-Pacific','Africa','Americas'],impact:['all','high','watch','update'],days:['7','30','90'],sort:['impact','newest']};
  const tool={name:'set_news_filters',title:'Filter sustainable-finance stories',description:'Filter the collected public-source news feed. Returns matching headlines and original sources, with coverage and freshness. Does not trigger a publisher refresh.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:200},...Object.fromEntries(Object.entries(choices).map(([key,values])=>[key,{type:'string',enum:values}]))},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Provide a filter object.');
    for(const [key,value]of Object.entries(input)){if(key==='query'){if(typeof value!=='string'||value.length>200)throw new Error('Search must be text of at most 200 characters.');}else if(!Object.hasOwn(choices,key)||!choices[key].includes(value))throw new Error('Invalid news filter: '+key);}
    view='all';viewChosen=true;Object.assign(state,input);visibleCount=20;syncControls();render();return {loaded,filters:{...state},count:filteredArticles().length,stories:filteredArticles().slice(0,30).map(a=>({headline:a.headline,source:a.source,url:a.url,published:a.published,importance:labels[a.importance]})),checkedAt:lastResponse?.checkedAt||null,coverage:'Selected publisher feeds; excerpt-based automatic assessments; not exhaustive.'};
  }};
  try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
