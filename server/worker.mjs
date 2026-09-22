import { getNews } from './news.mjs';
import { readerApi } from './reader.mjs';
const assets = __PUBLIC_ASSETS__;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(['/api/me','/api/preferences','/api/saved'].includes(url.pathname))return readerApi(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    if(url.pathname==='/api/news'){
      try{return json(await getNews(env,ctx));}catch(error){console.error('news_unavailable',error.message);return json({error:'News is temporarily unavailable. Please try again shortly.'},503);}
    }
    const route=url.pathname==='/'?'/index.html':url.pathname;const asset=assets[route];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"}});
  }
};
