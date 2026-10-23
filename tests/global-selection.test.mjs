import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {chromium} from 'playwright-core';

test('Global selection waits for delayed days, sends only one delete request, and stops on failure',{timeout:60000},async t=>{
  let executablePath;
  for(const p of [process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean)){
    try{await access(p);executablePath=p;break;}catch{}
  }
  if(!executablePath){t.skip('Chrome absent.');return;}
  const source=await readFile('docs/google-photos-corbeille.txt','utf8');
  // Speed up only the polling waits; the browser still performs real DOM clicks
  // and real scrolling. No Google account or network call is used.
  const script=source.replace('const sleep = ms => new Promise(r => setTimeout(r, ms));','const sleep = ms => new Promise(r => setTimeout(r, Math.min(ms, 30)));');
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    for(const scenario of ['success','declined','permanent','limit','stop','dropped-click','unrelated-controls','retention','lost-selection']){
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      const errors=[];
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      try{
        await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fr"><body><h1>SIMULATEUR — aucun compte réel</h1><button id="delete" aria-label="Supprimer">Supprimer</button><main style="height:300px;width:700px;overflow-y:auto"></main></body></html>',headers:{'Content-Security-Policy':"require-trusted-types-for 'script'; trusted-types 'none'"}}));
        await page.goto('https://photos.google.com/');
        await page.evaluate(scenario=>{
          window.qa={selected:0,requests:0,confirmed:0,days:0,late:false,allSelectedAtRequest:false};
          const main=document.querySelector('main');
          function addDay(){
            qa.days++;
            const section=document.createElement('section');section.style.height='220px';
            const b=document.createElement('button');b.setAttribute('aria-label','Sélectionner toutes les photos du jour '+qa.days);b.setAttribute('aria-checked','false');
            b.textContent='Jour '+qa.days;
            b.onclick=()=>{if(scenario==='dropped-click')return;const checked=b.getAttribute('aria-checked')==='true';b.setAttribute('aria-checked',String(!checked));qa.selected+=checked?-1:1;};
            section.append(b);main.append(section);
          }
          for(let i=0;i<3;i++)addDay();
          // A new page of days appears only after reaching the initial bottom.
          main.addEventListener('scroll',()=>{
            // Reproduce selection lost after the first traversal, when the
            // verification traversal returns to the top of the library.
            if(scenario==='lost-selection'&&main.scrollTop===0&&qa.late&&qa.selected===5){
              main.querySelector('[aria-checked="true"]').setAttribute('aria-checked','false');qa.selected--;
            }
            if(!qa.late&&main.scrollTop+main.clientHeight>=main.scrollHeight-3){
              qa.late=true;main.setAttribute('aria-busy','true');
              setTimeout(()=>{addDay();addDay();main.removeAttribute('aria-busy');},80);
            }
          });
          document.getElementById('delete').onclick=()=>{
            qa.requests++;qa.allSelectedAtRequest=qa.late&&qa.days===5&&qa.selected===5;
            if(scenario==='declined')return;
            const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
            const text=document.createElement('p');text.textContent=scenario==='permanent'?'Supprimer définitivement ces éléments de la corbeille ?':scenario==='retention'?'Placer les éléments sélectionnés dans la corbeille ? Les éléments seront supprimés définitivement après le délai de conservation.':'Placer les éléments sélectionnés dans la corbeille ?';
            const b=document.createElement('button');b.textContent=scenario==='permanent'?'Supprimer définitivement':'Placer dans la corbeille';
            b.onclick=()=>{qa.confirmed++;dialog.remove();};dialog.append(text,b);document.body.append(dialog);
          };
          if(scenario==='unrelated-controls'){
            const toolbar=document.createElement('button');toolbar.setAttribute('aria-label','Mode grille');toolbar.setAttribute('aria-pressed','true');toolbar.textContent='Mode grille';document.body.append(toolbar);
            const hiddenDialog=document.createElement('div');hiddenDialog.setAttribute('role','dialog');hiddenDialog.style.display='none';document.body.append(hiddenDialog);
          }
          if(scenario==='stop')setTimeout(()=>window.arreterSelectionGooglePhotos?.(),80);
        },scenario);
        await page.evaluate(scenario==='limit'?script.replace('const DEFILEMENTS_MAX = 100000;','const DEFILEMENTS_MAX = 1;'):script);
        const result=await page.evaluate(()=>qa);
        if(['success','unrelated-controls','retention'].includes(scenario)){
          assert.equal(result.allSelectedAtRequest,true,scenario);
          assert.equal(result.requests,1,scenario);assert.equal(result.confirmed,1,scenario);
        }else{
          assert.equal(result.confirmed,0,scenario);
          assert.equal(result.requests,scenario==='declined'||scenario==='permanent'?1:0,scenario);
        }
        if(scenario==='dropped-click')assert.match(errors.join('\n'),/clic de sélection n’a pas été confirmé/);
        if(scenario==='lost-selection')assert.match(errors.join('\n'),/passage de contrôle trouve des journées non sélectionnées/);
        assert.equal(await page.evaluate(()=>window.selectionGlobaleGooglePhotos),false);
      }finally{await page.close();}
    }
  }finally{await browser.close();}
});
