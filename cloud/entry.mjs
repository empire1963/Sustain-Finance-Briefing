import config from './auth-config.json';
import { createHandler } from './collector.mjs';
const projectUrl=Deno.env.get('SUPABASE_URL');
let keys={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
const serviceKey=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function database(path,method='GET',body,prefer){
  if(!projectUrl||!serviceKey)throw new Error('Supabase runtime configuration is unavailable');
  const headers={apikey:serviceKey,'Content-Type':'application/json'};
  if(!serviceKey.startsWith('sb_secret_'))headers.Authorization='Bearer '+serviceKey;
  if(prefer)headers.Prefer=prefer;
  const response=await fetch(projectUrl+'/rest/v1/'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Database request failed: '+response.status);
  const text=await response.text();return text?JSON.parse(text):[];
}
Deno.serve(createHandler({database,...config}));
