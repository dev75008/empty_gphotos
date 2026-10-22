import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {ZipWriter,BlobWriter,TextReader} from '@zip.js/zip.js';

async function makeZip(entries){
  const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false});
  for(const [name,value] of Object.entries(entries))await writer.add(name,new TextReader(value));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
test('Existing browser journal reorganizes remotely without ZIPs, then resumes new files with a flat gallery',{timeout:60000},async t=>{
  let executablePath;
  for(const path of [process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium',join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe')].filter(Boolean))try{await access(path);executablePath=path;break;}catch{}
  if(!executablePath){t.skip('Chrome absent. Set CHROME_PATH to run this UI check.');return;}
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const base='https://dev75008.github.io/empty_gphotos/',files=new Map(),folders=new Map();let next=1,uploads=0,copies=0;
    const metadata=file=>({fileid:file.fileid,parentfolderid:file.folderid,name:file.name,size:file.payload.length,isfolder:false});
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://eapi.pcloud.com'){
        const reply=data=>route.fulfill({json:{result:0,...data},headers:{'Access-Control-Allow-Origin':new URL(base).origin}});
        const fields=request.headers()['content-type']?.startsWith('multipart/form-data')
          ?await new Response(request.postDataBuffer(),{headers:{'Content-Type':request.headers()['content-type']}}).formData():new URLSearchParams(request.postData()||'');
        const folderid=Number(fields.get('folderid')),fileid=Number(fields.get('fileid')),file=files.get(fileid);
        const folder=[...folders].find(([,id])=>id===folderid);
        switch(url.pathname){
          case '/userinfo':return reply({userid:12});
          case '/createfolderifnotexists':{
            const key=folderid+'/'+fields.get('name');if(!folders.has(key))folders.set(key,next++);
            return reply({metadata:{folderid:folders.get(key)}});
          }
          case '/listfolder':{
            if(!folder)return route.fulfill({json:{result:2005},headers:{'Access-Control-Allow-Origin':new URL(base).origin}});
            const children=[...folders].filter(([key])=>key.startsWith(folderid+'/')).map(([key,id])=>({isfolder:true,folderid:id,parentfolderid:folderid,name:key.slice(key.indexOf('/')+1)}));
            if(!fields.has('nofiles'))children.push(...[...files.values()].filter(file=>file.folderid===folderid).map(metadata));
            return reply({metadata:{folderid,name:folder[0].slice(folder[0].indexOf('/')+1),contents:children}});
          }
          case '/uploadfile':{
            const upload=fields.get('file'),id=next++;uploads++;
            const file={fileid:id,folderid,name:upload.name,payload:Buffer.from(await upload.arrayBuffer())};files.set(id,file);return reply({metadata:[metadata(file)]});
          }
          case '/copyfile':{
            assert.equal(fields.get('noover'),'1');const target=Number(fields.get('tofolderid')),name=fields.get('toname');
            if([...files.values()].some(file=>file.folderid===target&&file.name===name))return route.fulfill({json:{result:2004},headers:{'Access-Control-Allow-Origin':new URL(base).origin}});
            assert.ok(file);const id=next++,copy={...file,fileid:id,folderid:target,name,payload:Buffer.from(file.payload)};files.set(id,copy);copies++;return reply({metadata:metadata(copy)});
          }
          case '/stat':return reply({metadata:metadata(file)});
          case '/checksumfile':return reply({metadata:metadata(file),sha1:createHash('sha1').update(file.payload).digest('hex'),sha256:createHash('sha256').update(file.payload).digest('hex')});
          case '/deletefile':files.delete(fileid);return reply({});
          case '/deletefolder':{
            if([...files.values()].some(file=>file.folderid===folderid)||[...folders.keys()].some(key=>key.startsWith(folderid+'/')))return route.fulfill({json:{result:2006},headers:{'Access-Control-Allow-Origin':new URL(base).origin}});
            assert.ok(folder);folders.delete(folder[0]);return reply({});
          }
          default:throw new Error('Unexpected simulator API: '+url.pathname);
        }
      }
      if(!url.href.startsWith(base)){await route.abort();return;}
      const relative=url.pathname.slice(new URL(base).pathname.length)||'index.html',root=resolve('docs'),path=resolve(root,relative);
      assert.ok(path.startsWith(root+'/')||path.startsWith(root+'\\'));
      const contentType=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.woff2')?'font/woff2':relative.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8';
      await route.fulfill({body:await readFile(path),contentType});
    });
    await page.addInitScript(()=>sessionStorage.setItem('passage-pcloud-auth-v1',JSON.stringify({host:'eapi.pcloud.com',token:'simulated-only'})));
    await page.goto(base);await page.waitForFunction(()=>document.getElementById('pcloud-state').textContent==='Connecté');
    const fixture=await makeZip({'photo.jpg':'photo','video.mp4':'video','photo.jpg.json':'metadata'});
    await page.evaluate(async bytes=>{
      const {openJournal}=await import('./browser-state.js?v=5'),{BrowserMigration}=await import('./browser-engine.js?v=5'),{BlobWriter}=await import('./vendor/archive.js');
      const journal=await openJournal(),engine=new BrowserMigration(journal),signal=new AbortController().signal;
      await engine.load();engine.auth=JSON.parse(sessionStorage.getItem('passage-pcloud-auth-v1'));
      await engine.select([new File([new Uint8Array(bytes)],'legacy.zip')]);await engine.scan(signal);
      const client=engine.client(signal),root=await engine.bind(client,signal);
      for(const object of engine.objects.values()){
        const folder=await engine.folder(client,object,root),entry=await engine.source(object),blob=await entry.getData(new BlobWriter());
        await engine.verified(object,await client.upload(object,blob,folder));
      }
      journal.db.close();
    },[...fixture]);
    assert.equal(uploads,3);
    await page.reload();await page.waitForFunction(()=>!document.getElementById('organize-button').disabled);
    assert.equal(await page.locator('#zip-files').evaluate(input=>input.files.length),0);
    await page.locator('#organize-button').click();await page.waitForFunction(()=>document.getElementById('job-state').textContent==='Regroupement terminé');
    const root=folders.get('0/Ma phototheque'),meta=folders.get(root+'/Métadonnées Takeout');
    assert.equal(files.size,3);assert.equal(uploads,3);assert.equal(copies,3);
    assert.deepEqual([...files.values()].filter(file=>file.folderid===root).map(file=>file.name).sort(),['photo.jpg','video.mp4']);
    assert.equal([...files.values()].find(file=>file.name.endsWith('.json')).folderid,meta);
    assert.equal([...folders.keys()].some(key=>key.endsWith('/Fichiers')),false);
    await page.locator('#zip-files').setInputFiles({name:'next.zip',mimeType:'application/zip',buffer:await makeZip({'next.jpg':'next photo'})});
    await page.locator('#scan-button').click();await page.waitForFunction(()=>!document.getElementById('run-button').disabled);
    await page.locator('#run-button').click();await page.waitForFunction(()=>document.getElementById('job-state').textContent==='Transfert terminé');
    assert.equal(uploads,4);assert.equal(files.size,4);assert.equal([...files.values()].filter(file=>file.folderid===root).length,3);
    assert.equal(await page.locator('#count-verified').textContent(),'4');assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
