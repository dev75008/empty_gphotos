/* Runs in Chrome's isolated extension world. No Google private API or cookies. */
(()=>{
  if(globalThis.PassagePhotosCleanup)return;
  const normalize=text=>(text||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const labels={
    move:new Set(['delete','supprimer','move to trash','move to bin','placer dans la corbeille','déplacer vers la corbeille','mettre à la corbeille']),
    empty:new Set(['empty trash','empty bin','vider la corbeille']),
    permanent:new Set(['delete permanently','permanently delete','supprimer définitivement']),
    photosEmpty:new Set(['no photos','no photos or videos','aucune photo','aucune photo ni vidéo','your photos and videos will appear here','vos photos et vidéos s’afficheront ici','vos photos et vidéos apparaîtront ici','your archive is empty','aucune photo archivée','vos archives sont vides']),
    trashEmpty:new Set(['trash is empty','your trash is empty','bin is empty','your bin is empty','la corbeille est vide','votre corbeille est vide','aucun élément dans la corbeille'])
  };
  const visible=el=>Boolean(el?.isConnected&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');
  const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
  const named=(el,names)=>names.has(normalize(el.getAttribute('aria-label')))||names.has(normalize(el.textContent));
  function uniqueButton(root,names){
    const matches=buttons(root).filter(el=>named(el,names));
    if(matches.length!==1)throw new Error('Bouton Google absent ou ambigu. Aucune autre action ne sera tentée.');
    return matches[0];
  }
  function route(){
    if(location.origin!=='https://photos.google.com')throw new Error('Cette commande est réservée à photos.google.com.');
    const path=location.pathname.replace(/^\/u\/\d+(?=\/|$)/,'').replace(/\/+$/,'')||'/';
    if(path==='/'||path==='/photos')return 'photos';
    if(path==='/archive')return 'archive';
    if(path==='/trash')return 'trash';
    throw new Error('Ouvrez Photos, Archive ou Corbeille. Recherche, albums et dossier verrouillé ne sont pas automatisés.');
  }
  function account(){
    const candidates=[...document.querySelectorAll('button[aria-label],a[aria-label],[role="button"][aria-label]')]
      .filter(el=>visible(el)&&/google account|compte google/i.test(el.getAttribute('aria-label')))
      .flatMap(el=>el.getAttribute('aria-label').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]);
    const emails=[...new Set(candidates.map(email=>email.toLowerCase()))];
    if(emails.length!==1)throw new Error('Adresse du compte Google illisible ou ambiguë. Vérifiez la connexion et la langue français/anglais.');
    return emails[0];
  }
  function main(){
    const roots=[...document.querySelectorAll('main,[role="main"]')].filter(visible);
    if(roots.length!==1)throw new Error('Zone de photos non reconnue. Aucun clic effectué.');
    return roots[0];
  }
  const dialogs=()=>[...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible);
  function entries(){
    const result=new Map();
    for(const box of main().querySelectorAll('[role="checkbox"][aria-checked]')){
      const item=box.closest('[data-id]');
      if(!item||!visible(item)||item.querySelectorAll('[role="checkbox"]').length!==1||!item.querySelector('img,[role="img"]'))continue;
      const id=item.getAttribute('data-id');if(!id)continue;
      if(result.has(id))throw new Error('Identifiant de média ambigu. Arrêt.');
      result.set(id,{id,item,box});
    }
    return result;
  }
  const selected=()=>[...document.querySelectorAll('[role="checkbox"][aria-checked="true"]')].filter(visible);
  function emptyMarker(names){
    return [...main().querySelectorAll('p,h1,h2,h3,div,span')].some(el=>visible(el)&&names.has(normalize(el.textContent)));
  }
  function mount(proof){
    try{
      if(document.getElementById('passage-photos-cleanup'))throw new Error('Les commandes sont déjà ouvertes. Fermez le panneau avant de le recharger.');
      if(!proof||!Number.isFinite(proof.expiresAt)||proof.expiresAt<=Date.now()||!proof.email||!Number.isSafeInteger(proof.files)||proof.files<1)throw new Error('Contrôle absent ou expiré.');
      route();if(account()!==proof.email)throw new Error('Le compte Google ouvert ne correspond pas à l’adresse saisie.');
      const host=document.createElement('div');host.id='passage-photos-cleanup';
      // Inline styles are confined to this extension-owned shadow tree.
      host.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483647;width:min(380px,calc(100vw - 32px));';
      const shadow=host.attachShadow({mode:'open'});
      shadow.innerHTML=`<style>
        :host{font:14px/1.5 system-ui,sans-serif;color:#16191d}*{box-sizing:border-box}section{background:#f2f4f7;border:1px solid #aeb5bd;border-radius:6px;padding:18px;max-height:calc(100vh - 32px);overflow:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:17px;margin:0}p{margin:10px 0}button,input{font:inherit}button{min-height:44px;background:#fff;border:1px solid #aeb5bd;border-radius:4px;color:inherit;padding:9px 12px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.actions{display:grid;gap:8px;margin:12px 0}small{color:#60646b;display:block}input[type=text]{width:100%;padding:10px;border:1px solid #aeb5bd;border-radius:4px;margin:8px 0}label{display:flex;gap:8px}input[type=checkbox]{width:18px;height:18px;flex:none}button:focus-visible,input:focus-visible{outline:2px solid #1d5fbf;outline-offset:2px}#stop{color:#9b2424}#status{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:14px}summary{cursor:pointer;min-height:32px}#email{overflow-wrap:anywhere}
        </style><section aria-label="Commandes Passage Photos"><header><h2>Passage Photos</h2><button id="close" aria-label="Fermer les commandes">Fermer</button></header>
        <p id="email"></p><small id="audit"></small>
        <p>Corbeille par lots. Le vidage définitif peut s’enchaîner si vous l’autorisez avant le lancement. Le contrôle porte sur vos ZIP, pas sur tout le compte Google.</p>
        <div class="actions"><button id="inspect">Examiner cette vue sans supprimer</button><button id="one" disabled>Tester sur 1 média</button><button id="all" disabled>Continuer par lots de 25</button><button id="stop" disabled>Arrêter</button></div>
        <p id="status" role="status">Examinez d’abord la vue ouverte.</p><small id="counts">0 média confirmé dans cette session.</small>
        <details id="permanent"><summary>Vider définitivement la corbeille</summary><p>Cette action détruit aussi les éléments déjà présents avant cette migration. Elle est irréversible.</p><label><input id="auto-empty" type="checkbox">Vider automatiquement la corbeille après cette vue</label><small>À activer pour votre dernier traitement, après vérification de Photos et Archive. Le vidage s’enchaîne seulement si Google indique la vue vide, jamais après une erreur ou un arrêt.</small><label><input id="old-trash" type="checkbox">J’ai vérifié toute la corbeille, y compris les anciens éléments, et mes copies sauvegardées.</label><input id="phrase" type="text" autocomplete="off" aria-label="Saisir VIDER LA CORBEILLE" placeholder="Saisir VIDER LA CORBEILLE"><button id="empty" disabled>Vider définitivement la corbeille</button></details>
        <div class="actions"><button id="journal">Télécharger le journal des commandes</button></div><small>Gardez cet onglet visible. Un clic, une touche ou un défilement manuel hors de ce panneau arrête l’automatisation. Après rechargement, importez à nouveau le contrôle ; aucun redémarrage automatique.</small></section>`;
      document.documentElement.append(host);
      const $=id=>shadow.getElementById(id);
      $('email').textContent=proof.email;$('audit').textContent=`${proof.files} fichiers pCloud contrôlés le ${new Date(proof.completedAt).toLocaleString('fr-FR')}.`;
      let controller=null,currentRoute=null,inspected=false,tested=false,count=0,records=[];
      const session=crypto.randomUUID();
      function status(message){$('status').textContent=message;}
      const permanentConsent=()=>$('old-trash').checked&&$('phrase').value==='VIDER LA CORBEILLE';
      function clearConsent(){$('auto-empty').checked=false;$('phrase').value='';$('old-trash').checked=false;}
      function render(){
        const busy=Boolean(controller),valid=Date.now()<proof.expiresAt;
        $('inspect').disabled=busy;$('one').disabled=busy||!valid||!inspected||currentRoute==='trash';
        $('all').disabled=busy||!valid||!inspected||!tested||currentRoute==='trash'||$('auto-empty').checked&&!permanentConsent();
        $('stop').disabled=!busy;$('close').disabled=busy;
        $('empty').disabled=busy||!valid||!inspected||currentRoute!=='trash'||!permanentConsent();
        for(const id of ['auto-empty','old-trash','phrase'])$(id).disabled=busy||!valid;
        $('counts').textContent=`${count} média(s) confirmé(s) dans cette session. Ce compteur ne prouve pas que le compte entier est vide.`;
      }
      function guard(scope,alternate){
        controller?.signal.throwIfAborted();
        if(Date.now()>=proof.expiresAt)throw new Error('Le contrôle a expiré. Arrêt ; relancez le contrôle intégral sur pCloud.');
        if(document.visibilityState!=='visible')throw new Error('Onglet masqué. Arrêt ; revenez sur Google Photos.');
        if(account()!==proof.email)throw new Error('Le compte Google a changé. Arrêt.');
        const actual=route();
        if(actual!==scope&&actual!==alternate)throw new Error('La vue Google Photos a changé. Arrêt ; examinez la nouvelle vue.');
      }
      async function record(event,extra={}){
        const row={time:new Date().toISOString(),event,scope:currentRoute,...extra};records.push(row);
        // If persistence fails, no further destructive click is attempted.
        await chrome.storage.local.set({lastCleanup:{session,email:proof.email,audit:proof.completedAt,confirmed:count,records:records.slice(-200)}});
      }
      async function sleep(ms,alternate){
        await new Promise((resolve,reject)=>{
          const signal=controller?.signal;
          const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
          const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
          signal?.addEventListener('abort',cancel,{once:true});
          if(signal?.aborted)cancel();
        });
        guard(currentRoute,alternate);
      }
      async function until(predicate,message,timeout=20000){
        const end=Date.now()+timeout;
        do{guard(currentRoute);if(predicate())return;await sleep(250);}while(Date.now()<end);
        throw new Error(message+' Aucun nouvel essai automatique : vérifiez le résultat dans Google Photos.');
      }
      function click(el){guard(currentRoute);if(!visible(el)||el.disabled||el.getAttribute('aria-disabled')==='true')throw new Error('Commande Google devenue indisponible.');el.click();}
      function noDialogs(){if(dialogs().length)throw new Error('Fermez la boîte de dialogue Google avant de continuer.');}
      async function navigateToTrash(){
        guard(currentRoute);noDialogs();
        const prefix=location.pathname.match(/^\/u\/\d+(?=\/|$)/)?.[0]||'';
        const links=[...document.querySelectorAll('a[href]')].filter(link=>{
          if(!visible(link))return false;
          const url=new URL(link.href,location.href),path=url.pathname.replace(/\/+$/,'');
          return url.origin===location.origin&&!url.search&&!url.hash&&(path===prefix+'/trash'||!prefix&&path==='/u/0/trash');
        });
        if(links.length!==1)throw new Error('Lien vers la corbeille absent ou ambigu. Vidage automatique annulé ; ouvrez la corbeille manuellement.');
        await record('navigation_corbeille');click(links[0]);
        const end=Date.now()+20000;
        while(route()!=='trash'){
          guard(currentRoute,'trash');
          if(Date.now()>=end)throw new Error('Ouverture de la corbeille non confirmée. Aucun vidage tenté.');
          await sleep(250,'trash');
        }
        currentRoute='trash';guard('trash');
        await until(()=>emptyMarker(labels.trashEmpty)||buttons(document).some(el=>named(el,labels.empty)),'La corbeille Google n’est pas prête.');
      }
      async function emptyTrash(){
        guard('trash');noDialogs();
        if(selected().length)throw new Error('Une sélection existe dans la corbeille. Arrêt sans vidage.');
        if(emptyMarker(labels.trashEmpty)){await record('corbeille_déjà_vide');status('Google indique la corbeille déjà vide.');return;}
        await record('vidage_demandé');click(uniqueButton(document,labels.empty));
        await until(()=>dialogs().length===1,'Confirmation de vidage non reconnue.');
        const dialog=dialogs()[0],text=normalize(dialog.textContent);
        if(!/permanen|définitiv/.test(text)||!/trash|corbeille|\bbin\b/.test(text))throw new Error('Confirmation définitive non reconnue. Aucun clic de confirmation.');
        const matches=buttons(dialog).filter(el=>named(el,labels.permanent)||named(el,labels.empty));
        if(matches.length!==1)throw new Error('Bouton de confirmation définitive absent ou ambigu.');
        await record('vidage_confirmation');click(matches[0]);
        await until(()=>dialogs().length===0&&emptyMarker(labels.trashEmpty),'Vidage non confirmé par Google.',30000);
        await record('corbeille_vide');status('Google indique la corbeille vide. Les suppressions définitives ne peuvent pas être annulées.');
      }
      async function batch(limit){
        guard(currentRoute);noDialogs();
        if(selected().length)throw new Error('Une sélection existe déjà. Annulez-la manuellement avant de reprendre.');
        const media=[...entries().values()].filter(({item})=>{const r=item.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}).slice(0,limit);
        if(!media.length)return 0;
        const ids=media.map(m=>m.id);
        await record('lot_préparé',{ids});
        for(const {box,item} of media){
          guard(currentRoute);item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
          click(box);await sleep(100);
          if(box.getAttribute('aria-checked')!=='true')throw new Error('La sélection du média n’a pas été confirmée. Arrêt.');
        }
        if(selected().length!==media.length||media.some(m=>!m.box.isConnected||m.box.getAttribute('aria-checked')!=='true'))throw new Error('La sélection a changé. Arrêt sans suppression.');
        await record('corbeille_demandée',{ids});
        noDialogs();click(uniqueButton(document,labels.move));
        await until(()=>dialogs().length===1,'Confirmation Google non reconnue.');
        const dialog=dialogs()[0],text=normalize(dialog.textContent);
        if(/permanen|définitiv|empty trash|vider la corbeille/.test(text)||!/trash|corbeille|\bbin\b/.test(text))throw new Error('Google propose une action définitive ou inattendue. Arrêt sans confirmer.');
        // Only an explicit move-to-trash confirmation is allowed here.
        click(uniqueButton(dialog,labels.move));
        await until(()=>dialogs().length===0&&ids.every(id=>![...main().querySelectorAll('[data-id]')].some(el=>el.getAttribute('data-id')===id))&&selected().length===0,'Réception du lot non confirmée.');
        count+=ids.length;tested=true;await record('lot_confirmé',{ids});render();
        status(`${ids.length} média(s) placé(s) dans la corbeille. Attente avant le lot suivant.`);
        await sleep(1800);return ids.length;
      }
      async function run(operation){
        if(controller)return;controller=new AbortController();render();
        try{guard(currentRoute);await operation();}
        catch(error){status(error.name==='AbortError'?'Arrêt demandé. Une opération déjà envoyée à Google peut encore aboutir. Vérifiez la sélection et la corbeille avant de reprendre.':error.message);await record('arrêt',{message:error.message}).catch(()=>{});}
        finally{controller=null;inspected=false;clearConsent();render();}
      }
      $('inspect').onclick=()=>{
        try{
          currentRoute=route();guard(currentRoute);noDialogs();
          if(selected().length)throw new Error('Annulez la sélection Google existante avant d’examiner la vue.');
          const size=entries().size;inspected=true;
          status(`Vue : ${currentRoute==='photos'?'Photos':currentRoute==='archive'?'Archive':'Corbeille'}. ${size} média(s) reconnu(s) dans la page chargée. Aucun clic de suppression effectué.`);
        }catch(error){inspected=false;status(error.message);}render();
      };
      $('one').onclick=()=>{
        if(!inspected||!confirm(`Placer UN média du compte ${proof.email} dans la corbeille pour tester ?`))return;
        run(async()=>{if(!await batch(1))throw new Error('Aucun média sélectionnable à l’écran. Faites défiler puis examinez à nouveau.');status('Test confirmé. Vérifiez le média dans la corbeille, revenez à cette vue et examinez-la avant de continuer par lots.');});
      };
      $('all').onclick=()=>{
        const autoEmpty=$('auto-empty').checked;
        if($('all').disabled||!inspected||!tested||autoEmpty&&!permanentConsent())return;
        const finalAction=autoEmpty?' Puis vider AUTOMATIQUEMENT ET DÉFINITIVEMENT TOUTE la corbeille, y compris les anciens éléments. Cette action est irréversible.':'';
        if(!confirm(`Placer TOUS les médias accessibles de cette vue (${currentRoute}) du compte ${proof.email} dans la corbeille, par lots de 25 ? Les ajouts absents de l’export seraient également concernés.${finalAction}`))return;
        run(async()=>{
          await record('lots_autorisés',{autoEmpty});
          let idle=0;
          for(let rounds=0;rounds<20000;rounds++){
            if(await batch(25)){idle=0;continue;}
            if(emptyMarker(labels.photosEmpty)){
              await record('vue_vide');
              if(autoEmpty){
                await sleep(1500);
                if(entries().size||selected().length||!emptyMarker(labels.photosEmpty)||[...document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].some(visible))throw new Error('La vue vide n’est pas confirmée ou Google charge encore des éléments. Aucun vidage automatique.');
                await record('vidage_auto_autorisé');
                status('Vue vide confirmée. Ouverture de la corbeille pour le vidage autorisé.');await navigateToTrash();await emptyTrash();
              }
              else status('Google indique cette vue vide. Vérifiez ensuite Photos ET Archive. Le dossier verrouillé et les éléments seulement partagés nécessitent une vérification manuelle. La corbeille reste conservée.');
              return;
            }
            if(++idle>3)throw new Error('La grille ne progresse pas. Arrêt ; vérifiez le chargement avant de reprendre.');
            // A virtualized grid may not have loaded its next items yet.
            const root=main(),scroll=[root,...root.querySelectorAll('*')].find(el=>el.scrollHeight>el.clientHeight+100&&/auto|scroll/.test(getComputedStyle(el).overflowY));
            if(scroll)scroll.scrollBy(0,Math.max(200,scroll.clientHeight*.8));else window.scrollBy(0,Math.max(200,innerHeight*.8));
            await sleep(2000);
            if(!entries().size&&!emptyMarker(labels.photosEmpty))throw new Error('Aucun média reconnu et aucune preuve de vue vide. Arrêt : vérifiez Google Photos, le chargement et la langue.');
          }
          throw new Error('Limite de session atteinte. Vérifiez la vue avant de reprendre.');
        });
      };
      $('empty').onclick=()=>{
        if($('empty').disabled||$('phrase').value!=='VIDER LA CORBEILLE'||!$('old-trash').checked)return;
        if(!confirm(`Supprimer DÉFINITIVEMENT TOUTE la corbeille du compte ${proof.email}, y compris les anciens éléments ? Cette action est irréversible.`))return;
        clearConsent();run(emptyTrash);
      };
      for(const id of ['phrase','old-trash','auto-empty'])$(id).addEventListener('input',render);
      const stop=()=>controller?.abort(new DOMException('Arrêt utilisateur','AbortError'));
      $('stop').onclick=stop;
      const interrupt=event=>{if(event.isTrusted&&!event.composedPath().includes(host))stop();};
      for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,interrupt,true);
      const hidden=()=>{if(document.visibilityState!=='visible')stop();};document.addEventListener('visibilitychange',hidden);
      $('close').onclick=()=>{if(controller)return;host.remove();for(const event of ['pointerdown','keydown','wheel'])document.removeEventListener(event,interrupt,true);document.removeEventListener('visibilitychange',hidden);};
      $('journal').onclick=async()=>{
        try{
          const previous=(await chrome.storage.local.get('lastCleanup')).lastCleanup;
          const blob=new Blob([JSON.stringify({format:'passage-photos-commandes',scope:'Commandes UI seulement, sans certificat de couverture Google.',session,email:proof.email,confirmed:count,records,previous:previous?.session!==session?previous:undefined},null,2)],{type:'application/json'});
          const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='passage-photos-nettoyage.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
        }catch(error){status(error.message);}
      };
      render();return {ready:true};
    }catch(error){return {error:error.message};}
  }
  globalThis.PassagePhotosCleanup={mount};
})();
