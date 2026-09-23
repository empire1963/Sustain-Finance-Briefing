import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handle } from '../runtime/app.mjs';
const port=Number(process.env.PORT||4174);
const assets={'/':['public/index.html','text/html; charset=utf-8'],'/index.html':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','application/javascript; charset=utf-8'],'/styles.css':['public/styles.css','text/css; charset=utf-8']};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname.startsWith('/api/')){
      const options={method:req.method,headers:req.headers};
      if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
      const response=await handle(new Request(url,options));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const asset=assets[url.pathname];if(!asset){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-cache'});res.end(await readFile(asset[0]));
  }catch{res.writeHead(500);res.end('Run npm run build first and check your environment configuration.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/`));
process.on('SIGINT',()=>server.close());
