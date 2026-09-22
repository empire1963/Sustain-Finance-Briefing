const day = 86400000;
export function assess(headline, summary, topic, now=Date.now()) {
  const s=headline+' '+summary;
  const proposal=/\b(propos\w*|consult\w*|draft|seeks feedback|could|mulls|considers)\b/i.test(headline);
  const target=/\b(targets?|aims?|plans?|pledges?|seeks? to|up to)\b/i.test(headline);
  const conditional=/\b(subject to|conditional on|pending approval|not yet approved|has not secured|does not approve|did not approve|has not approved)\b/i.test(s);
  const negative=/\b(repeals?|repealed|rejects?|rejected|blocks?|blocked|cancels?|cancelled|canceled|withdraws?|withdrawn|scraps?|scrapped)\b/i.test(headline);
  const decision=/\b(adopts?|adopted|enacts?|enacted|finalises?|finalizes?|approves?|approved|passed|passes|takes? effect|comes? into force|fines?|fined)\b/i.test(headline);
  const delivered=/\b(disburses?|disbursed|completes?|completed|closes?|closed|issued|issues|raises|raised|secures?|secured)\b/i.test(headline);
  const commitment=/\b(commits?|committed|signs?|signed|launches?|launched|invests?|invested)\b/i.test(headline);
  const research=/\b(report|study|research|survey|analysis|outlook)\b/i.test(headline);
  let status='News update',stageScore=0;
  if(negative&&!/\b(could|may|mulls|considers|proposal to|proposes to)\b/i.test(headline)){status='Reversal / rejection reported';stageScore=35;}
  else if(proposal){status='Proposal / consultation';stageScore=15;}
  else if(conditional){status='Conditional / unconfirmed';stageScore=8;}
  else if(negative){status='Reversal / rejection reported';stageScore=35;}
  else if(target){status='Target / intention';stageScore=8;}
  else if(decision){status=topic==='ESG policy'?'Policy decision reported':'Approval reported';stageScore=topic==='ESG policy'?35:25;}
  else if(delivered){status='Completion / financing reported';stageScore=30;}
  else if(commitment){status='Commitment / launch reported';stageScore=25;}
  else if(research)status='Research / analysis';

  const international=/\b(European Union|European Commission|EU|European Parliament|G20|G7|global treaty)\b/.test(headline);
  const national=/\b(UK|United Kingdom|US|U\.S\.|United States|China|Japan|Canada|Australia|South Africa|India|FCA|SEC|national|government|parliament)\b/.test(headline);
  const scopeScore=international?20:national?15:0;
  // Preserve currency and qualifiers; never equate yen with dollars or sum amounts.
  const money=[...s.matchAll(/(?:US\$|USD\s*|EUR\s*|GBP\s*|JPY\s*|RMB\s*|[€£$¥])\s*\d[\d,.]*(?:\s*(?:trillion|billion|million|tn\b|bn\b|mn\b|[bBmM]\b))?/g)].map(m=>m[0]);
  const amount=money[0]||null;
  const supported=amount&&/^(?:US\$|USD|EUR|GBP|[€£$])/.test(amount);
  const unit=amount?.match(/trillion|billion|million|tn\b|bn\b|mn\b|[bBmM]\b/)?.[0]?.toLowerCase();
  const raw=Number(amount?.match(/\d[\d,.]*/)?.[0]?.replaceAll(',',''));
  const value=raw*(/^(trillion|tn)$/.test(unit)?1e12:/^(billion|bn|b)$/.test(unit)?1e9:/^(million|mn|m)$/.test(unit)?1e6:1);
  let scaleScore=supported?(value>=1e10?25:value>=1e9?20:value>=1e8?10:0):0;
  const qualified=target||conditional||/\b(up to|target|aim|plan|pledge|potential|could)\b/i.test(s);
  if(qualified||proposal)scaleScore=Math.min(scaleScore,8);
  const score=Math.min(100,stageScore+scopeScore+scaleScore);
  const importance=score>=50?'high':score>=25||proposal||topic==='ESG policy'?'watch':'update';
  const reasons=[`${status} (${stageScore} points)`,scopeScore?`Named ${international?'cross-border':'national'} scope (${scopeScore} points)`:'Wider scope not established (0 points)',amount?`${qualified?'Qualified amount':'First stated amount'}: ${amount} (${scaleScore} points)`:'No explicit currency amount identified (0 points)'];
  return {status,importance,score,importanceReason:reasons.join('. ')+'. This is reading priority, not a reliability or investment score.',brief:{stage:status,amount,qualification:qualified?'Check conditions, targets and delivery in the source.':null},assessedAt:new Date(now).toISOString()};
}

const normalized=s=>s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const tokens=s=>new Set(normalized(s).split(' ').filter(x=>x.length>2&&!['the','and','for','with','from','into','its','new','that','this','has','have','will','says'].includes(x)));
function related(a,b){
  if(a.status!==b.status||a.topic!==b.topic||a.region!==b.region)return false;
  if(a.brief?.amount&&b.brief?.amount&&a.brief.amount!==b.brief.amount)return false;
  if(!a.published||!b.published||Math.abs(Date.parse(a.published)-Date.parse(b.published))>3*day)return false;
  if(normalized(a.headline)===normalized(b.headline))return true;
  // Very conservative title matching: preserve differently reported developments separately.
  const x=tokens(a.headline),y=tokens(b.headline),overlap=[...x].filter(t=>y.has(t)).length;
  if(Math.min(x.size,y.size)<7||overlap/Math.max(x.size,y.size)<0.88)return false;
  const numbers=s=>[...s.matchAll(/\d[\d,.]*/g)].map(m=>m[0]).join('|');
  return numbers(a.headline)===numbers(b.headline)&&a.brief?.amount===b.brief?.amount;
}
export function groupCoverage(articles){
  const groups=[];
  for(const article of articles){
    const group=groups.find(g=>related(g,article));
    const coverage={id:article.id,url:article.url,headline:article.headline,source:article.source,sourceId:article.sourceId,published:article.published,subscription:article.subscription,linkLabel:article.linkLabel};
    if(group){if(!group.coverage.some(c=>c.url===article.url))group.coverage.push(coverage);}
    else groups.push({...article,coverage:[coverage]});
  }
  return groups;
}
