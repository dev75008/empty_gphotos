// This page only supplies text. Nothing is injected into a Google tab.
const field=document.getElementById('console-script');
const status=document.getElementById('console-status');
const copy=document.getElementById('console-copy');
const details=document.getElementById('console-source');
async function load(){
  try{
    const response=await fetch('./google-photos-corbeille.txt?v=2');
    if(!response.ok)throw new Error('Téléchargement indisponible');
    field.value=await response.text();copy.disabled=false;
    status.textContent='Sélection globale prête à copier : toutes les journées accessibles, puis une seule mise à la corbeille.';
  }catch{
    status.textContent='Chargement impossible. Rechargez la page ou téléchargez le fichier du script ci-dessous.';
  }
}
copy.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(field.value);
    status.textContent='Script copié. Dans la console Google Photos, collez-le puis appuyez sur Entrée pour démarrer.';
  }catch{
    details.open=true;field.focus();field.select();
    status.textContent='Copie automatique bloquée. Le script est sélectionné : utilisez Ctrl+C (ou Cmd+C).';
  }
});
load();
