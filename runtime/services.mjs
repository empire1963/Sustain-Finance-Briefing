import { createClient } from '@supabase/supabase-js';

export function configuration(env){
  const url=env.SUPABASE_URL?.trim(),publishable=env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if(!url||!publishable)throw Object.assign(new Error('Set the Supabase environment values in your hosting settings.'),{status:503});
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))throw new Error('Supabase requires HTTPS');
  if(publishable.startsWith('sb_secret_'))throw new Error('Use a publishable key for SUPABASE_PUBLISHABLE_KEY');
  if(publishable.split('.').length===3){
    try{if(JSON.parse(Buffer.from(publishable.split('.')[1],'base64url')).role!=='anon')throw new Error('Invalid public key');}
    catch{throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key');}
  }
  return {url:parsed.origin,publishable,secret:env.SUPABASE_SECRET_KEY?.trim(),publicNews:env.SUSTAIN_PUBLIC_NEWS==='true',allowedEmails:(env.SUSTAIN_ALLOWED_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)};
}

function unwrap(result){if(result.error)throw result.error;return result.data;}
export function createServices(config,fetcher=fetch){
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options={})=>fetcher(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)})}};
  const auth=createClient(config.url,config.publishable,options);
  let admin;
  function database(){
    if(!config.secret)throw Object.assign(new Error('Set SUPABASE_SECRET_KEY in your hosting settings.'),{status:503});
    return admin??=createClient(config.url,config.secret,options);
  }
  return {
    async user(token){const {data,error}=await auth.auth.getUser(token);if(error||!data?.user)return null;return data.user;},
    async snapshot(){const db=database();const [rows,state]=await Promise.all([db.from('sustain_sources').select('source_id,articles,checked_at,fetched_at,error'),db.from('sustain_collector').select('last_started,last_finished,last_error,successful_sources,total_sources,run_count').eq('id',true).single()]);return {rows:unwrap(rows),collector:unwrap(state)};},
    async reader(userId){const db=database();const [preferences,saved]=await Promise.all([db.from('sustain_reader_preferences').select('preferences').eq('user_id',userId).maybeSingle(),db.from('sustain_saved_stories').select('payload,saved_at').eq('user_id',userId).order('saved_at',{ascending:false}).limit(500)]);return {preferences:unwrap(preferences)?.preferences,saved:unwrap(saved).map(row=>({...row.payload,savedAt:Number(row.saved_at)}))};},
    async preferences(userId,preferences){unwrap(await database().from('sustain_reader_preferences').upsert({user_id:userId,preferences,updated_at:Date.now()},{onConflict:'user_id'}));return preferences;},
    async save(userId,url,payload,savedAt){const rows=unwrap(await database().rpc('sustain_save_story',{p_user_id:userId,p_url:url,p_payload:payload,p_saved_at:savedAt}));const row=Array.isArray(rows)?rows[0]:rows;if(!row)throw new Error('Save returned no row');return {...row.payload,savedAt:Number(row.saved_at)};},
    async remove(userId,url){unwrap(await database().from('sustain_saved_stories').delete().eq('user_id',userId).eq('article_url',url));}
  };
}
