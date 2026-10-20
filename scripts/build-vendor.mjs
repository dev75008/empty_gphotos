import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('docs/vendor', {recursive:true});
await build({entryPoints:['scripts/vendor-entry.js'], outfile:'docs/vendor/archive.js', bundle:true,
  format:'esm', platform:'browser', target:'es2022', minify:true, legalComments:'linked'});
await copyFile('node_modules/@zip.js/zip.js/LICENSE', 'docs/vendor/LICENSE-zip.js.txt');
await copyFile('node_modules/@noble/hashes/LICENSE', 'docs/vendor/LICENSE-noble-hashes.txt');
