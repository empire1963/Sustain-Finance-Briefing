export const SOURCES = [
  {id:'esg-today',name:'ESG Today',url:'https://www.esgtoday.com/feed/',home:'https://www.esgtoday.com/',hosts:['esgtoday.com'],scope:'Global ESG and sustainable investment',kind:'Journalism',focused:false},
  {id:'esg-news',name:'ESG News',url:'https://esgnews.com/category/sustainable-finance/feed/',home:'https://esgnews.com/category/sustainable-finance/',hosts:['esgnews.com'],scope:'Global sustainable finance',kind:'News & announcements',focused:true},
  {id:'responsible-investor',name:'Responsible Investor',url:'https://www.responsible-investor.com/feed/',home:'https://www.responsible-investor.com/',hosts:['responsible-investor.com'],scope:'Responsible investment and policy',kind:'Journalism',focused:true,subscription:true},
  {id:'carbon-pulse',name:'Carbon Pulse',url:'https://carbon-pulse.com/feed/',home:'https://carbon-pulse.com/',hosts:['carbon-pulse.com'],scope:'Carbon markets and climate finance',kind:'Journalism',focused:true,subscription:true,topic:'Carbon markets'},
  {id:'unep-fi',name:'UNEP Finance Initiative',url:'https://www.unepfi.org/feed/',home:'https://www.unepfi.org/',hosts:['unepfi.org'],scope:'Sustainable banking, insurance and investment',kind:'Institutional source',focused:true},
  {id:'eco-business',name:'Eco-Business',url:'https://www.eco-business.com/feeds/category/8/',home:'https://www.eco-business.com/feeds/',hosts:['eco-business.com'],scope:'Asia-Pacific policy and finance',kind:'Journalism',focused:false,region:'Asia-Pacific',linkLabel:'Read full article on Eco-Business'},
  {id:'adb',name:'Asian Development Bank',url:'https://feeds.feedburner.com/adb_news',home:'https://www.adb.org/rss',hosts:['adb.org'],scope:'Asia-Pacific development and climate finance',kind:'Institutional source',focused:false,region:'Asia-Pacific'},
  {id:'eib',name:'European Investment Bank',url:'https://www.eib.org/press/all/index.rss',home:'https://www.eib.org/en/press',hosts:['eib.org'],scope:'Development, energy and climate investment',kind:'Official source',focused:false},
  {id:'ec-finance',name:'European Commission Finance',url:'https://finance.ec.europa.eu/node/1408/rss_en',home:'https://finance.ec.europa.eu/news_en',hosts:['ec.europa.eu'],scope:'EU financial policy and sustainable finance',kind:'Official source',focused:false,region:'Europe'},
  {id:'fca',name:'Financial Conduct Authority',url:'https://www.fca.org.uk/news/rss.xml',home:'https://www.fca.org.uk/news',hosts:['fca.org.uk'],scope:'UK regulation, disclosure and investment',kind:'Official source',focused:false,region:'Europe'},
  {id:'ecb',name:'European Central Bank',url:'https://www.ecb.europa.eu/rss/press.html',home:'https://www.ecb.europa.eu/',hosts:['ecb.europa.eu'],scope:'European climate risk and monetary policy',kind:'Official source',focused:false,region:'Europe'},
  {id:'bis',name:'Bank for International Settlements',url:'https://www.bis.org/doclist/all_pressrels.rss',home:'https://www.bis.org/',hosts:['bis.org'],scope:'Global banking policy and climate risk',kind:'Official source',focused:false},
  {id:'sec',name:'US Securities and Exchange Commission',url:'https://www.sec.gov/news/pressreleases.rss',home:'https://www.sec.gov/newsroom/press-releases',hosts:['sec.gov'],scope:'US securities policy and ESG disclosures',kind:'Official source',focused:false,region:'Americas'},
  {id:'trellis',name:'Trellis',url:'https://trellis.net/feed/',home:'https://trellis.net/',hosts:['trellis.net','greenbiz.com'],scope:'Corporate sustainability and finance',kind:'Journalism',focused:false},
  {id:'greenmoney',name:'GreenMoney',url:'https://greenmoney.com/feed/',home:'https://greenmoney.com/',hosts:['greenmoney.com'],scope:'Sustainable and impact investing',kind:'Analysis & commentary',focused:true},
  {id:'african-climate-wire',name:'African Climate Wire',url:'https://africanclimatewire.org/feed/',home:'https://africanclimatewire.org/',hosts:['africanclimatewire.org'],scope:'African climate policy and finance',kind:'Journalism',focused:false,region:'Africa'},
  {id:'renewafrica',name:'RenewAfrica',url:'https://renewafrica.biz/feed/',home:'https://renewafrica.biz/',hosts:['renewafrica.biz'],scope:'African renewable-energy investment',kind:'News & announcements',focused:false,region:'Africa'}
];
export const REFRESH_MS = 15 * 60 * 1000;
export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_PER_SOURCE = 100;
