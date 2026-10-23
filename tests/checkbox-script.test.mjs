import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {chromium} from 'playwright-core';

test('User checkbox script selects without deleting by default; true mode moves media and excludes memories',{timeout:90000},async t=>{
  let executablePath;
  for(const p of [process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean)){
    try{await access(p);executablePath=p;break;}catch{}
  }
  if(!executablePath){t.skip('Chrome absent.');return;}
  const original=await readFile('docs/google-photos-corbeille.txt','utf8');
  assert.match(original,/const SUPPRIMER = false;/);
  assert.match(original,/const LOT = 1000;/);
  const script=original.replace('const sleep = ms => new Promise(r => setTimeout(r, ms));','const sleep = ms => new Promise(r => setTimeout(r, Math.min(ms, 10)));');
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    for(const deleting of [false,true]){
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      try{
        await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fr"><body><h1>SIMULATEUR — aucun compte réel</h1><button id="memory" aria-label="Supprimer ce souvenir">Souvenir</button><button id="delete" aria-label="Supprimer">Supprimer</button><main></main></body></html>',headers:{'Content-Security-Policy':"require-trusted-types-for 'script'; trusted-types 'none'"}}));
        await page.goto('https://photos.google.com/');
        await page.evaluate(()=>{
          window.qa={selected:0,requests:0,confirmed:0,memories:0};
          const main=document.querySelector('main');
          for(let i=0;i<6;i++){
            const box=document.createElement('button');box.setAttribute('role','checkbox');box.setAttribute('aria-checked','false');box.textContent='Média '+i;
            box.onclick=()=>{box.setAttribute('aria-checked','true');qa.selected++;};main.append(box);
          }
          document.getElementById('memory').onclick=()=>qa.memories++;
          document.getElementById('delete').onclick=()=>{
            qa.requests++;const d=document.createElement('div');d.setAttribute('role','dialog');
            const p=document.createElement('p');p.textContent='Placer les éléments dans la corbeille ?';
            const b=document.createElement('button');b.textContent='Placer dans la corbeille';
            b.onclick=()=>{qa.confirmed++;main.replaceChildren();d.remove();};d.append(p,b);document.body.append(d);
          };
        });
        await page.evaluate(deleting?script.replace('const SUPPRIMER = false;','const SUPPRIMER = true;'):script);
        const result=await page.evaluate(()=>qa);
        assert.equal(result.selected,6);assert.equal(result.memories,0);
        assert.equal(result.requests,deleting?1:0);assert.equal(result.confirmed,deleting?1:0);
      }finally{await page.close();}
    }
  }finally{await browser.close();}
});
