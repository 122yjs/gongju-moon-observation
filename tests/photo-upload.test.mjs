import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/photo-upload.js',import.meta.url),'utf8');
function harness(options={}) {
 const nodes=new Map();
 const calls={reset:0,cleared:0,requests:[],photoStatus:[],submitStatus:[],revoked:[],session:0,pending:0,saved:[]};
 function element(id='') {
  const e={id,dataset:{},value:'',children:[],listeners:{},classList:{add(){},remove(){}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(k,v){this.listeners[k]=v;},append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},reset(){calls.reset++;},focus(){},select(){}};
  if(id)nodes.set(id,e);return e;
 }
 for(const id of ['observationForm','photoPreview','captureInput','photoInput','photoPreviewWrap','photoPlaceholder','studentNumber','studentName','observedAt','memo'])element(id);
 nodes.get('studentNumber').value='3';nodes.get('studentName').value='private student';nodes.get('memo').value='private memo';nodes.get('observedAt').value='2026-09-11T08:00';
 const oldBlob=new Blob(['old'],{type:'image/jpeg'}),newBlob=new Blob(['new'],{type:'image/jpeg'});
 const pipeline={async compress(){if(options.photoThrows)throw options.photoThrows;return newBlob;},async send(values,blob,id){calls.requests.push({values,blob,id});if(options.sendThrows)throw options.sendThrows;const status=options.status||200;return{response:{status,ok:status===200},result:{message:status===200?'saved':'error'}};},diagnostic:{async step(stage,fn){return fn();},report(){return{events:[]};}}};
 const context=vm.createContext({Blob,oldBlob,newBlob,console,setTimeout,clearTimeout,
  document:{getElementById:id=>nodes.get(id),createElement:()=>element()},
  navigator:{},crypto:{randomUUID(){if(options.uuidThrows)throw new Error('no uuid');return'new-id';}},
  URL:{revokeObjectURL(url){calls.revoked.push(url);},createObjectURL(){return'blob:new';}},
  MoonPhotoPipeline:options.absent?undefined:{version:'test',create:()=>pipeline},
  photoStatus:(...a)=>calls.photoStatus.push(a),submitStatus:(...a)=>calls.submitStatus.push(a),
  saveDraft:force=>calls.saved.push(force),writePending:()=>calls.pending++,
  incrementReset:()=>calls.cleared++,incrementSession:()=>calls.session++,nodes
 });
 vm.runInContext(`
 let photoProcessing=false,submissionBusy=false,compressedImageBlob=oldBlob;
 let pendingRequestId='existing-id',previewObjectUrl='blob:previous',hasClassSession=true,galleryLoaded=false;
 function readPhotoDimensions(){} function compressImage(){} function previewPhoto(){} function submitObservation(){}
 function setPhotoBusy(value){photoProcessing=value;} function setSubmitBusy(value){submissionBusy=value;}
 function prepareExternalCamera(){compressedImageBlob=null;} function writeCameraPending(){writePending();}
 function clearCameraPending(){} function saveObservationDraft(force){saveDraft(force);} function stopCamera(){}
 function showPhotoStatus(...args){photoStatus(...args);} function showSubmitStatus(...args){submitStatus(...args);}
 function attachPhoto(blob){compressedImageBlob=blob;pendingRequestId='';if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=URL.createObjectURL(blob);nodes.get('photoPreview').src=previewObjectUrl;}
 function clearObservationDraft(){incrementReset();} function checkSession(){incrementSession();}
 function hidePhotoStatus(){} function setObservedAtNow(){} function refreshGallery(){} function showToast(){}
 `,context);
 const oldFunction=context.previewPhoto;vm.runInContext(source,context);
 const get=expression=>vm.runInContext(expression,context);
 const input=nodes.get('photoInput');input.files=[new Blob(['incoming'],{type:'image/jpeg'})];input.value='selected';
 return{context,calls,nodes,input,oldBlob,newBlob,get,oldFunction,preview:()=>context.previewPhoto({target:input}),submit:()=>context.submitObservation({preventDefault(){}})};
}
test('adapter installs once and adds non-submit diagnostic controls',()=>{const h=harness();assert.notEqual(h.context.previewPhoto,h.oldFunction);assert.equal(h.nodes.get('observationForm').dataset.photoPipelineVersion,'test');const children=h.nodes.get('observationForm').children;assert.equal(children.length,1);assert.equal(children[0].children.filter(n=>n.type==='button').length,2);vm.runInContext(source,h.context);assert.equal(children.length,1);});
test('missing optional module leaves original page handlers intact',()=>{const h=harness({absent:true});assert.equal(h.context.previewPhoto,h.oldFunction);});
test('photo replacement failure preserves old Blob, preview and request ID',async()=>{const h=harness({photoThrows:Object.assign(new Error('decode failed'),{photoStage:'decode'})});await h.preview();assert.equal(h.get('compressedImageBlob'),h.oldBlob);assert.equal(h.get('pendingRequestId'),'existing-id');assert.equal(h.nodes.get('photoPreview').src,'blob:previous');assert.equal(h.get('photoProcessing'),false);assert.equal(h.input.value,'');});
test('successful photo replacement resets ID only after attachment',async()=>{const h=harness();await h.preview();assert.equal(h.get('compressedImageBlob'),h.newBlob);assert.equal(h.get('pendingRequestId'),'');assert.deepEqual(h.calls.revoked,['blob:previous']);assert.equal(h.get('photoProcessing'),false);});
test('cancelled empty selection does not discard attachment',async()=>{const h=harness();h.input.files=[];await h.preview();assert.equal(h.get('compressedImageBlob'),h.oldBlob);assert.equal(h.get('pendingRequestId'),'existing-id');});
for(const stage of ['FormData','fetch','response'])test(`${stage} failure restores controls and preserves retry state`,async()=>{const h=harness({sendThrows:Object.assign(new Error('failure'),{photoStage:stage})});await h.submit();assert.equal(h.get('submissionBusy'),false);assert.equal(h.get('compressedImageBlob'),h.oldBlob);assert.equal(h.get('pendingRequestId'),'existing-id');assert.equal(h.calls.reset,0);assert.equal(h.calls.cleared,0);});
test('manual retry retains ID and never submits automatically',async()=>{const h=harness({sendThrows:new Error('network')});await h.submit();assert.equal(h.calls.requests.length,1);await h.submit();assert.equal(h.calls.requests.length,2);assert.ok(h.calls.requests.every(request=>request.id==='existing-id'));});
test('successful API response alone clears current form and attachment',async()=>{const h=harness();await h.submit();assert.equal(h.get('compressedImageBlob'),null);assert.equal(h.get('pendingRequestId'),'');assert.equal(h.get('submissionBusy'),false);assert.equal(h.calls.reset,1);assert.equal(h.calls.cleared,1);});
test('401 rechecks session without clearing photo',async()=>{const h=harness({status:401});await h.submit();assert.equal(h.calls.session,1);assert.equal(h.get('compressedImageBlob'),h.oldBlob);assert.equal(h.calls.reset,0);});
test('unconfirmed response is never displayed as success',async()=>{const h=harness({sendThrows:Object.assign(new Error('bad response'),{photoCode:'UPLOAD_RESULT_UNKNOWN'})});await h.submit();assert.equal(h.calls.reset,0);assert.equal(h.get('pendingRequestId'),'existing-id');assert.ok(h.calls.submitStatus.at(-1)[0].includes('제출 여부'));});
test('UUID exception also releases submission busy state',async()=>{const h=harness({uuidThrows:true});vm.runInContext("pendingRequestId=''",h.context);await h.submit();assert.equal(h.get('submissionBusy'),false);assert.equal(h.calls.requests.length,0);});
test('external camera launch saves pending state without discarding an attached photo',()=>{const h=harness();h.context.prepareExternalCamera();assert.equal(h.get('compressedImageBlob'),h.oldBlob);assert.equal(h.get('pendingRequestId'),'existing-id');assert.equal(h.calls.pending,1);assert.deepEqual(h.calls.saved,[true]);assert.equal(h.get('previewObjectUrl'),'blob:previous');});
