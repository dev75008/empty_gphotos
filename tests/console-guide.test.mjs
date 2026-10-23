import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';

test('Console guide copies the supplied script without executing it and offers a clipboard fallback',{timeout:30000},async t=>{
  let executablePath;
  for(const p of [process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium',join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe')].filter(Boolean)){
    try{await access(p);executablePath=p;break;}catch{}
  }
  if(!executablePath){t.skip('Chrome absent.');return;}
  const script=await readFile('docs/google-photos-corbeille.txt','utf8');
  assert.doesNotThrow(()=>new Function(script)); // Syntax only; never run account commands.
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const base='https://dev75008.github.io/empty_gphotos/';
    await page.route('**/*',async r=>{
      const url=new URL(r.request().url());
      if(!url.href.startsWith(base)){await r.abort();return;}
      const relative=decodeURIComponent(url.pathname.slice(new URL(base).pathname.length))||'index.html';
      const root=resolve('docs'),path=resolve(root,relative);
      assert.ok(path.startsWith(root+'/')||path.startsWith(root+'\\'));
      const contentType=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.txt')?'text/plain; charset=utf-8':relative.endsWith('.woff2')?'font/woff2':relative.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8';
      await r.fulfill({body:await readFile(path),contentType});
    });
    await page.goto(base+'#console-google');
    await page.waitForFunction(()=>!document.getElementById('console-copy').disabled);
    assert.equal(await page.locator('#console-script').inputValue(),script);
    assert.equal(await page.locator('#console-google a').first().getAttribute('href'),'https://photos.google.com/');
    assert.equal(await page.locator('#console-google a').first().getAttribute('rel'),'noopener noreferrer');
    assert.match(await page.locator('#console-google').innerText(),/Il ne vide pas la corbeille/);
    await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.copiedScript=value;}});});
    await page.locator('#console-copy').click();
    assert.equal(await page.evaluate(()=>window.copiedScript),script);
    assert.match(await page.locator('#console-status').textContent(),/Script copié/);
    assert.equal(await page.evaluate(()=>window.googlePhotosSuppressionEnCours),undefined);
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:1000});
      await page.locator('#console-google').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.CONSOLE_UI_SCREENSHOTS){
        await mkdir('.taste-skill',{recursive:true});
        await page.locator('#console-google').screenshot({path:`.taste-skill/console-guide-${width}.png`});
      }
    }
    await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Blocked');}});});
    await page.locator('#console-copy').click();
    await page.waitForFunction(()=>document.getElementById('console-source').open);
    assert.equal(await page.locator('#console-source').getAttribute('open'),'');
    assert.match(await page.locator('#console-status').textContent(),/Ctrl\+C/);
    assert.equal(await page.locator('#console-script').evaluate(el=>el.selectionEnd-el.selectionStart),script.length);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
