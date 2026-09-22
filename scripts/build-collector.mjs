import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.sites-runtime/collector',{recursive:true});
await build({entryPoints:['cloud/entry.mjs'],outfile:'.sites-runtime/collector/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
console.log('Built cloud collector from the locked application dependencies.');
