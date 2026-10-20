import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateProof} from '../extension/proof.js';
import {inventoryFingerprint} from '../docs/cleanup.js';

function dossier(){
  const object={id:'a'.repeat(64),sha256:'a'.repeat(64),sha1:'b'.repeat(40),size:100,status:'verified',fileid:2,folderid:3,checked:new Date().toISOString(),category:'Medias'};
  const archive={id:'c'.repeat(64),complete:true,name:'takeout.zip'};
  const binding={host:'eapi.pcloud.com',userid:12,folderid:1};
  const audit={deep:true,completedAt:new Date().toISOString(),inventory:inventoryFingerprint(new Map([[object.id,object]]),new Map([[archive.id,archive]]),binding)};
  return {format:'passage-photos-browser',version:1,objects:[object],archives:[archive],settings:[{id:'binding',value:binding}],cleanup_review:{audit,summary:{total:1,verified:1,remaining:0,errors:0,archives:[{...archive,unverified_entries:0}]}}};
}
test('Extension accepts a consistent full-readback dossier from the website',async()=>{
  const data=dossier(),proof=await validateProof(data);
  assert.equal(proof.files,1);assert.equal(proof.parts,1);
  assert.equal(proof.inventory,data.cleanup_review.audit.inventory);
});
test('Extension rejects incomplete, expired, future, altered or quick verification dossiers',async()=>{
  const changes=[
    d=>d.objects[0].status='pending',d=>d.objects[0].fileid=null,
    d=>d.objects[0].size++,d=>d.archives[0].complete=false,
    d=>d.objects.push({...d.objects[0]}),d=>d.cleanup_review.summary.remaining=1,
    d=>d.cleanup_review.summary.archives[0].unverified_entries=1,
    d=>d.cleanup_review.audit.deep=false,
    d=>d.cleanup_review.audit.completedAt=new Date(Date.now()-86401000).toISOString(),
    d=>d.cleanup_review.audit.completedAt=new Date(Date.now()+100000).toISOString(),
    d=>d.settings[0].value.userid++,d=>delete d.cleanup_review
  ];
  for(const mutate of changes){const data=dossier();mutate(data);await assert.rejects(validateProof(data));}
});
test('Extension asks for temporary tab access only, with no permanent host access',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);
  assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.externally_connectable,undefined);
});
