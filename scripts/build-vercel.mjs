import { build } from 'esbuild';
import { mkdir,copyFile,readdir } from 'node:fs/promises';
await mkdir('public',{recursive:true});
for(const name of ['index.html','styles.css'])await copyFile('dist/'+name,'public/'+name);
await build({entryPoints:['dist/app.js'],outfile:'public/app.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
for(const name of (await readdir('api')).filter(name=>name.endsWith('.js'))){const module=await import('../api/'+name);if(typeof module.default?.fetch!=='function')throw new Error('Invalid Vercel function '+name);}
console.log('Built frontend and verified all five Vercel function exports.');
