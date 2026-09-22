import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { RETENTION_MS, MAX_PER_SOURCE } from './sources.mjs';
import { assess } from './assessment.mjs';

const parser = new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false,removeNSPrefix:true});
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value==='string'?value:typeof value==='number'?String(value):value?.['#text']??'';
const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…',euro:'€',pound:'£',copy:'©',trade:'™',bull:'•'};
function decode(value){return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,key)=>{if(key[0]!=='#')return named[key]??m;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});}
export function plainText(value){let s=text(value).slice(0,50000);for(let i=0;i<2;i++)s=decode(s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' '));return s.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();}
export function excerpt(value){const s=plainText(value).replace(/\s*(?:The post .+? appeared first on|Read (?:more|the full article)|Continue reading)[\s\S]*$/i,'').trim();if(!s)return '';const words=s.split(/\s+/);let result=words.slice(0,45).join(' ');if(result.length>330)result=result.slice(0,330).replace(/\s+\S*$/,'');return result.length<s.length?result.replace(/[,. ;:]+$/,'')+'…':result;}
export function canonicalUrl(value,source){try{const u=new URL(text(value),source.home);if(u.protocol!=='https:'&&u.protocol!=='http:')return null;if(u.username||u.password)return null;const host=u.hostname.toLowerCase().replace(/^www\./,'');if(!source.hosts.some(h=>host===h||host.endsWith('.'+h)))return null;u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key))u.searchParams.delete(key);return u.href;}catch{return null;}}

const finance = /\b(invest\w*|financ\w*|fund\w*|bank\w*|bond\w*|capital|lender\w*|lend\w*|credit\w*|loan\w*|insurance|insurer\w*|asset\w*|portfolio\w*|pension\w*|disclos\w*|taxonomy|taxonomies|reporting|regulat\w*|policy|policies|legislation|stewardship|shareholder\w*|greenwash\w*|carbon market\w*|ets|emissions trading|csrd|sfdr|issb|ifrs s[12]|securit\w*)\b/i;
const sustainability = /\b(esg|sustainab\w*|climate|green|clean energy|renewable\w*|solar|wind|carbon|nature|biodivers\w*|conservation|forest\w*|transition|net.zero|decarbon\w*|resilien\w*|adaptation|impact invest\w*|social bond\w*|blue bond\w*|water)\b/i;
export function relevant(title,description,source){if(/^(?:podcast|webinar|job vacancy|sponsored webinar|upcoming event)\b/i.test(title))return false;const s=title+' '+description;return source.focused||finance.test(s)&&sustainability.test(s);}
export function classify(headline,description,source,now=Date.now()){
  const s=headline+' '+description;
  const topic= /\b(biodivers\w*|nature|conservation|rhino\w*|forest\w*|blue bond\w*)\b/i.test(s)?'Nature finance':/\b(carbon market\w*|carbon credit\w*|offset\w*|ets|emissions trading|carbon pric\w*)\b/i.test(s)?'Carbon markets':/\b(disclos\w*|regulat\w*|taxonomy|taxonomies|csrd|sfdr|issb|reporting|greenwash\w*|legislation|lawmakers|sec|policy|policies)\b/i.test(headline)?'ESG policy':/\b(transition|decarbon\w*|net.zero|adaptation|resilien\w*)\b/i.test(s)?'Transition finance':source.topic||'Green investment';
  const rules=[['Africa',/\b(africa\w*|kenya\w*|nigeria\w*|egypt\w*|morocco|ghana|rwanda|ethiopia|zambia|namibia|uganda|tanzania|senegal)\b/i],['Asia-Pacific',/\b(asia\w*|pacific|china|chinese|india\w*|japan\w*|singapore\w*|australia\w*|indonesia\w*|vietnam\w*|malaysia\w*|philippine\w*|thailand|korea\w*|hong kong|new zealand)\b/i],['Europe',/\b(europe\w*|EU|UK|britain|british|united kingdom|german\w*|france|french|sweden|swedish|norway|norwegian|netherlands|dutch|swiss|switzerland|spain|spanish|italy|italian|ECB)\b/i],['Americas',/\b(america\w*|united states|U\.S\.|USA|canada|canadian|brazil\w*|mexic\w*|latin america|chile\w*|colombia\w*|argentina|caribbean|SEC )/i]];
  const regions=rules.filter(([,pattern])=>pattern.test(s)).map(([region])=>region);
  if(!regions.length)regions.push(source.region||'Global');
  const context={'ESG policy':'Reporting and policy developments can change obligations, costs and the information available to investors.','Green investment':'Financing terms, the use of proceeds and measurable outcomes help distinguish an announcement from delivered impact.','Transition finance':'Credible transition finance depends on achievable milestones, sector context and evidence of emissions reductions.','Nature finance':'Nature-finance outcomes depend on credible ecological measures and how benefits reach local communities.','Carbon markets':'Credit integrity, pricing and market rules shape the role of carbon markets in financing climate action.'};
  return {topic,regions,region:regions.join(' · '),whyItMatters:context[topic],...assess(headline,description,topic,now)};
}
export function parseFeed(xml,source,now=Date.now()){
  if(typeof xml!=='string'||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported feed format');
  if(XMLValidator.validate(xml)!==true)throw new Error('Invalid XML');
  const root=parser.parse(xml);const raw=root.rss?.channel?.item??root.feed?.entry??root.RDF?.item;
  if(!root.rss&&!root.feed&&!root.RDF)throw new Error('Not an RSS or Atom feed');
  const items=[];
  for(const item of array(raw).slice(0,200)){
    const headline=plainText(item.title).slice(0,260);if(!headline)continue;
    const atomLink=array(item.link).find(l=>l?.['@_href']&&(!l['@_rel']||l['@_rel']==='alternate'))?.['@_href'];
    const url=canonicalUrl(item.origLink||atomLink||item.link||item.guid,source);if(!url)continue;
    const rawDescription=item.description??item.summary??''; // Never ingest full content:encoded.
    const description=plainText(rawDescription);
    if(!relevant(headline,description,source))continue;
    let rawDate=text(item.pubDate||item.published||item.date||item.updated);
    const fcaDate=rawDate.match(/^\w+, (\w+ \d{1,2}, \d{4}) - \d{2}:\d{2}$/);
    if(fcaDate)rawDate=fcaDate[1]+' 12:00:00 GMT';
    const timestamp=Date.parse(rawDate);
    if(Number.isFinite(timestamp)&&(timestamp>now+5*60*1000||timestamp<now-RETENTION_MS))continue;
    const published=Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
    const summary=excerpt(rawDescription);
    items.push({id:url,url,headline,source:source.name,sourceId:source.id,sourceKind:source.kind,published,datePrecision:fcaDate||/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?'day':'time',summary,summaryType:description?'Publisher excerpt':'Headline only',subscription:!!source.subscription,linkLabel:source.linkLabel||'Read original source',...classify(headline,summary,source,now)});
  }
  return {articles:deduplicate(items),feedItems:array(raw).length};
}
export function deduplicate(items){const urls=new Set();return items.filter(a=>{if(urls.has(a.url))return false;urls.add(a.url);return true;});}
export function mergeArticles(fresh,old,now=Date.now()){return deduplicate([...fresh,...old]).filter(a=>!a.published||Date.parse(a.published)>=now-RETENTION_MS).sort((a,b)=>(b.published||'').localeCompare(a.published||'')).slice(0,MAX_PER_SOURCE);}
