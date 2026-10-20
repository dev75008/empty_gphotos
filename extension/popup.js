import {validateProof} from './proof.js';
const $=id=>document.getElementById(id);
let proof=null,pending=false;
function render(){$('attach').disabled=pending||!proof||!$('scope').checked||!$('email').validity.valid||!$('email').value.trim();}
$('proof').addEventListener('change',async()=>{
  proof=null;render();const file=$('proof').files[0];if(!file)return;
  try{
    proof=await validateProof(JSON.parse(await file.text()));
    $('proof-status').textContent=`${proof.files} fichiers vérifiés, ${proof.parts} parties. Contrôle du ${new Date(proof.completedAt).toLocaleString('fr-FR')}.`;
  }catch(error){$('proof-status').textContent=error.message;}render();
});
for(const id of ['scope','email'])$(id).addEventListener('input',render);
$('attach').addEventListener('click',async()=>{
  if(pending)return;pending=true;render();$('status').className='';
  try{
    if(!proof||Date.now()>proof.expiresAt)throw new Error('Le contrôle a expiré. Refaites-le sur le site.');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.url||new URL(tab.url).origin!=='https://photos.google.com')throw new Error('Ouvrez Google Photos dans cet onglet, puis cliquez à nouveau sur l’extension.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['automation.js']});
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:payload=>globalThis.PassagePhotosCleanup.mount(payload),args:[{...proof,email:$('email').value.trim().toLowerCase()}]});
    if(result?.error)throw new Error(result.error);
    window.close();
  }catch(error){$('status').textContent=error.message;$('status').className='error';}
  finally{pending=false;render();}
});
