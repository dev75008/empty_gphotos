// This page only supplies text. Nothing is injected into a Google tab.
const field=document.getElementById('console-script');
const status=document.getElementById('console-status');
const copy=document.getElementById('console-copy');
const details=document.getElementById('console-source');
const mode=document.getElementById('console-delete-mode');
let original='';
function renderMode(){
  field.value=mode.checked?original.replace('const SUPPRIMER = false;','const SUPPRIMER = true;'):original;
  copy.textContent=mode.checked?'Copier le script de mise à la corbeille':'Copier le script en mode test';
  status.textContent=mode.checked?'Mise à la corbeille activée : le script sélectionnera puis enverra les médias par lots de 1 000 au départ. Il ne vide pas la corbeille.':'Mode test : le script sélectionne jusqu’à 1 000 cases, puis s’arrête sans suppression.';
}
async function load(){
  try{
    const response=await fetch('./google-photos-corbeille.txt?v=3');
    if(!response.ok)throw new Error('Téléchargement indisponible');
    original=await response.text();mode.checked=false;mode.disabled=false;copy.disabled=false;renderMode();
  }catch{
    status.textContent='Chargement impossible. Rechargez la page ou téléchargez le fichier du script ci-dessous.';
  }
}
mode.addEventListener('change',renderMode);
copy.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(field.value);
    status.textContent=mode.checked?'Script de mise à la corbeille copié. Il démarre après collage et Entrée dans Google Photos.':'Script de test copié. Après collage et Entrée, il sélectionne seulement ; aucune suppression.';
  }catch{
    details.open=true;field.focus();field.select();
    status.textContent='Copie automatique bloquée. Le script est sélectionné : utilisez Ctrl+C (ou Cmd+C).';
  }
});
load();
