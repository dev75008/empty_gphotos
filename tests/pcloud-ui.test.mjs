import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';

test('pCloud connection explains its prerequisite and activates after saving the public Client ID',{timeout:30000},async t=>{
  let executablePath;
  for(const path of [process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium',join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')].filter(Boolean)){
    try{await access(path);executablePath=path;break;}catch{}
  }
  if(!executablePath){t.skip('Chrome absent. Set CHROME_PATH to run this UI check.');return;}
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const base='https://dev75008.github.io/empty_gphotos/';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(!url.href.startsWith(base)){await route.abort();return;}
      const relative=decodeURIComponent(url.pathname.slice(new URL(base).pathname.length))||'index.html';
      const root=resolve('docs'),path=resolve(root,relative);
      assert.ok(path.startsWith(root+'/')||path.startsWith(root+'\\'));
      const contentType=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.woff2')?'font/woff2':relative.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8';
      await route.fulfill({body:await readFile(path),contentType});
    });
    await page.goto(base);
    await page.waitForFunction(()=>!document.getElementById('credentials-fields').disabled);
    assert.equal(await page.locator('#auth-button').isDisabled(),true);
    assert.match(await page.locator('#auth-hint').textContent(),/Enregistrer le Client ID/);
    assert.equal(await page.locator('#credentials-details').getAttribute('open'),'');
    await page.locator('#client-id').fill('public-client-id-test');
    assert.equal(await page.locator('#auth-button').isDisabled(),true);
    await page.getByRole('button',{name:'Enregistrer le Client ID'}).click();
    await page.waitForFunction(()=>!document.getElementById('auth-button').disabled);
    assert.match(await page.locator('#auth-hint').textContent(),/Client ID enregistré/);
    await page.reload();
    await page.waitForFunction(()=>!document.getElementById('auth-button').disabled);
    assert.equal(await page.locator('#client-id').inputValue(),'public-client-id-test');
    const request=page.waitForRequest(url=>url.url().startsWith('https://my.pcloud.com/oauth2/authorize?'));
    await page.locator('#auth-button').click();
    const authorization=new URL((await request).url());
    assert.equal(authorization.searchParams.get('client_id'),'public-client-id-test');
    assert.equal(authorization.searchParams.get('redirect_uri'),base);
    assert.equal(authorization.searchParams.get('response_type'),'token');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
