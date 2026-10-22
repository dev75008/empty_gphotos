import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright-core';

async function chromePath(){
  const pf=process.env.PROGRAMFILES||'C:/Program Files',pf86=process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)';
  for(const path of [process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',join(pf,'Google/Chrome/Application/chrome.exe'),join(pf86,'Microsoft/Edge/Application/msedge.exe')].filter(Boolean)){
    try{await access(path);return path;}catch{}
  }
}

test('Isolated extension commands: batches, stop, wrong account and separate permanent deletion', {timeout:60000},async t=>{
  const executablePath=await chromePath();
  if(!executablePath){t.skip('Chrome/Chromium absent. Set CHROME_PATH to run the simulated UI checks.');return;}
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const html=await readFile(new URL('./fixtures/google-photos-ui.html',import.meta.url),'utf8');
    // Every request is intercepted. No Google account, cookie, or photo is used.
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().isNavigationRequest()?html:''}));
    await page.goto('https://photos.google.com/');
    const cdp=await page.context().newCDPSession(page),{frameTree}=await cdp.send('Page.getFrameTree');
    const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'extension-qa'});
    async function isolated(expression){
      const result=await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    }
    await isolated('window.confirm=()=>true;window.chrome={storage:{local:{set:async value=>window.stored=value,get:async()=>window.stored||{}}}};');
    await isolated(await readFile(new URL('../extension/automation.js',import.meta.url),'utf8'));
    const proof={email:'test@example.com',files:3,expiresAt:Date.now()+120000,completedAt:new Date().toISOString()};
    assert.match((await isolated('PassagePhotosCleanup.mount('+JSON.stringify({...proof,email:'wrong@example.com'})+')')).error,/correspond/);
    assert.equal((await isolated('PassagePhotosCleanup.mount('+JSON.stringify(proof)+')')).ready,true);
    const click=id=>page.evaluate(id=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById(id).click(),id);
    const until=check=>page.waitForFunction(check,null,{timeout:15000});
    await click('inspect');assert.equal(await page.evaluate(()=>qa.moves),0);
    await click('one');await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.startsWith('Test confirmé'));
    assert.equal(await page.evaluate(()=>qa.moves),1);
    await click('inspect');await click('all');await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.startsWith('Google indique cette vue vide'));
    assert.equal(await page.evaluate(()=>qa.moves),3);assert.equal(await page.evaluate(()=>qa.permanent),0);
    await page.evaluate(()=>{qa.reset(1);qa.mode='permanent';});await click('inspect');await click('one');
    await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.includes('définitive ou inattendue'));
    assert.equal(await page.evaluate(()=>qa.permanent),0);
    await page.evaluate(()=>{qa.reset(1);qa.mode='normal';});await click('inspect');await click('one');
    await page.evaluate(()=>document.getElementById('account').setAttribute('aria-label','Compte Google : Other (other@example.com)'));
    await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.includes('compte Google a changé'));
    assert.equal(await page.evaluate(()=>qa.moves),3);
    await page.evaluate(()=>{document.getElementById('account').setAttribute('aria-label','Compte Google : Test (test@example.com)');qa.reset(2);});
    await click('inspect');await click('all');await click('stop');
    await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('stop').disabled);
    assert.equal(await page.evaluate(()=>qa.moves),3);
    await page.evaluate(()=>{qa.reset(1);const duplicate=document.getElementById('delete').cloneNode(true);duplicate.id='ambiguous-delete';duplicate.disabled=false;document.body.append(duplicate);});
    await click('inspect');await click('one');
    await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.includes('absent ou ambigu'));
    assert.equal(await page.evaluate(()=>qa.moves),3);
    await page.evaluate(()=>{document.getElementById('ambiguous-delete').remove();qa.reset(1);history.pushState({},'','/trash');});await click('inspect');
    assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('empty').disabled),true);
    await page.evaluate(()=>{const root=document.getElementById('passage-photos-cleanup').shadowRoot;root.getElementById('permanent').open=true;root.getElementById('old-trash').checked=true;root.getElementById('phrase').value='VIDER LA CORBEILLE';root.getElementById('phrase').dispatchEvent(new Event('input'));});
    await click('empty');await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.startsWith('Google indique la corbeille vide'));
    assert.equal(await page.evaluate(()=>qa.permanent),1);
    assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('phrase').value),'');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('Automatic emptying requires explicit consent and a completed empty view; stops and ambiguous states never empty',{timeout:120000},async t=>{
  const executablePath=await chromePath();if(!executablePath){t.skip('Chrome absent.');return;}
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const html=await readFile(new URL('./fixtures/google-photos-ui.html',import.meta.url),'utf8');
    const script=await readFile(new URL('../extension/automation.js',import.meta.url),'utf8');
    for(const scenario of ['success','stop','missing-link','expired','account-changed','unexpected-dialog','loading']){
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      try{
        await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().isNavigationRequest()?html:''}));
        await page.goto('https://photos.google.com/');
        const cdp=await page.context().newCDPSession(page),{frameTree}=await cdp.send('Page.getFrameTree');
        const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'auto-empty-qa'});
        const isolated=async expression=>{
          const response=await cdp.send('Runtime.evaluate',{contextId:executionContextId,expression,awaitPromise:true,returnByValue:true});
          if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;
        };
        await isolated('window.prompts=[];window.confirm=text=>{prompts.push(text);return true;};window.chrome={storage:{local:{set:async value=>window.stored=value,get:async()=>window.stored||{}}}};');
        await isolated(script);
        const proof={email:'test@example.com',files:3,expiresAt:Date.now()+120000,completedAt:new Date().toISOString()};
        await isolated('globalThis.qaProof='+JSON.stringify(proof)+';PassagePhotosCleanup.mount(qaProof)');
        const click=id=>page.evaluate(id=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById(id).click(),id);
        const until=fn=>page.waitForFunction(fn,null,{timeout:15000});
        await click('inspect');await click('one');
        await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent.startsWith('Test confirmé'));
        assert.equal(await page.evaluate(()=>qa.permanent),0);
        await page.evaluate(()=>qa.reset(1));await click('inspect');
        await page.evaluate(()=>{const r=document.getElementById('passage-photos-cleanup').shadowRoot;r.getElementById('auto-empty').checked=true;r.getElementById('auto-empty').dispatchEvent(new Event('input'));});
        assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('all').disabled),true);
        await page.evaluate(()=>{const r=document.getElementById('passage-photos-cleanup').shadowRoot;r.getElementById('old-trash').checked=true;r.getElementById('phrase').value='VIDER LA CORBEILLE';r.getElementById('phrase').dispatchEvent(new Event('input'));});
        assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('all').disabled),false);
        if(scenario==='missing-link')await page.evaluate(()=>document.getElementById('trash-link').remove());
        if(scenario==='loading')await page.evaluate(()=>{const progress=document.createElement('div');progress.setAttribute('role','progressbar');progress.textContent='Chargement';document.body.append(progress);});
        if(scenario==='expired')await isolated('qaProof.expiresAt=Date.now()+700');
        if(scenario==='account-changed')await page.evaluate(()=>{const link=document.getElementById('trash-link'),navigate=link.onclick;link.onclick=event=>{navigate(event);document.getElementById('account').setAttribute('aria-label','Compte Google : Other (other@example.com)');};});
        if(scenario==='unexpected-dialog')await page.evaluate(()=>{document.getElementById('empty-button').onclick=()=>{const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='Une action inattendue';const button=document.createElement('button');button.textContent='Supprimer définitivement';button.onclick=()=>qa.permanent++;dialog.append(button);document.body.append(dialog);};});
        await click('all');if(scenario==='stop')await click('stop');
        await until(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('stop').disabled);
        assert.equal(await page.evaluate(()=>qa.permanent),scenario==='success'?1:0,scenario);
        if(scenario==='success'){
          assert.equal(await page.evaluate(()=>location.pathname),'/trash');
          assert.match(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('status').textContent),/Google indique la corbeille vide/);
        }
        assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('auto-empty').checked),false);
        assert.equal(await page.evaluate(()=>document.getElementById('passage-photos-cleanup').shadowRoot.getElementById('phrase').value),'');
        assert.ok((await isolated('prompts')).some(text=>text.includes('AUTOMATIQUEMENT ET DÉFINITIVEMENT TOUTE la corbeille')&&text.includes('test@example.com')));
      }finally{await page.close();}
    }
  }finally{await browser.close();}
});
