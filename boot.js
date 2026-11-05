(()=>{
'use strict';
const el=id=>document.getElementById(id),sessionName='maicy-classroom-access-v1';
const root=el('classroomRoot'),template=root.innerHTML;
let accessKey=null,documents=null,config=null,currentDoc=null,appLoading=null;
const imageCache=new Map(),views={};
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const to64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function bytes(url){let last;for(let attempt=0;attempt<3;attempt++){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch('./'+url.replace(/^\//,''),{signal:controller.signal,cache:'default'});if(!r.ok)throw Error('HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());}catch(e){last=e;}finally{clearTimeout(timer);}}throw Error('图片连接超时，请点“重新加载题目”重试。');}
async function decrypt(data){return crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)},accessKey,data.slice(12));}
async function readCatalog(){return JSON.parse(new TextDecoder().decode(await decrypt(await bytes('/catalog.bin'))));}
function showLogin(message=''){root.hidden=true;el('loadingApp').hidden=true;el('passwordPanel').hidden=false;el('materialPanel').hidden=true;el('unlock').hidden=false;el('unlockError').textContent=message;el('accessPassword').focus();}
function lock(){window.classroomApp?.destroy();window.classroomApp=null;try{sessionStorage.removeItem(sessionName);sessionStorage.removeItem('maicy-last-material');}catch(e){}accessKey=null;documents=null;currentDoc=null;for(const p of imageCache.values())p.then(URL.revokeObjectURL).catch(()=>{});imageCache.clear();document.body.classList.remove('menu');history.replaceState(null,'',location.pathname);showLogin();}
window.lockClassroom=lock;
window.resolveProtectedImage=async url=>{
 if(!accessKey)throw Error('请先输入访问口令。');
 if(!/^\/assets\/[a-f0-9]+\.bin$/.test(url))throw Error('图片路径不正确。');
 if(!imageCache.has(url))imageCache.set(url,(async()=>{const data=new Uint8Array(await decrypt(await bytes(url)));return URL.createObjectURL(new Blob([data],{type:data[0]===137?'image/png':'image/jpeg'}));})().catch(e=>{imageCache.delete(url);throw e;}));
 return imageCache.get(url);
};
function ensureApp(){if(window.mountClassroom)return Promise.resolve();if(!appLoading)appLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./app.js?v=5';script.onload=resolve;script.onerror=()=>reject(Error('画板加载失败，请刷新后重试。'));document.body.append(script);});return appLoading;}
async function switchDoc(doc,replace=false){
 if(!accessKey||!documents?.[doc])return;
 if(currentDoc===doc&&window.classroomApp){el('unlock').hidden=true;root.hidden=false;document.body.classList.remove('menu');return;}
 el('unlock').hidden=true;el('loadingApp').hidden=false;
 try{
  await ensureApp();
  if(window.classroomApp){views[currentDoc]=window.classroomApp.captureView();window.classroomApp.destroy();window.classroomApp=null;}
  root.innerHTML=template;root.hidden=false;document.body.classList.remove('menu');
  const summaries=Object.entries(documents).map(([key,d])=>({key,name:key==='sync'?'同步练习':'第四、六单元试卷',count:d.questions.length}));
  window.classroomApp=window.mountClassroom(documents[doc],{docKey:doc,documents:summaries,view:views[doc]});currentDoc=doc;
  (replace?history.replaceState:history.pushState).call(history,{doc},'',location.pathname+'?doc='+doc);
  try{sessionStorage.setItem('maicy-last-material',doc);}catch(e){}
 }catch(err){showLogin(err.message);}
 finally{el('loadingApp').hidden=true;}
}
window.changeClassroomMaterial=doc=>switchDoc(doc);
window.showMaterialChooser=()=>{if(!accessKey)return;el('passwordPanel').hidden=true;el('materialPanel').hidden=false;el('unlock').hidden=false;};
window.addEventListener('popstate',()=>{if(accessKey)switchDoc(new URLSearchParams(location.search).get('doc')||'sync',true);});
document.querySelectorAll('#materialPanel [data-doc]').forEach(b=>b.onclick=()=>switchDoc(b.dataset.doc));
el('lockAtHome').onclick=lock;
function initialDoc(){let last='sync';try{last=sessionStorage.getItem('maicy-last-material')||'sync';}catch(e){}const doc=new URLSearchParams(location.search).get('doc')||last;return documents[doc]?doc:'sync';}
el('unlockForm').addEventListener('submit',async e=>{
 e.preventDefault();el('unlockButton').disabled=true;el('unlockButton').textContent='正在验证…';el('unlockError').textContent='';
 try{
  if(!config)throw Error('课堂仍在准备，请稍后再试。');if(!crypto.subtle)throw Error('请使用安全网址或更新浏览器后重试。');
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(el('accessPassword').value),'PBKDF2',false,['deriveKey']);
  accessKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt:from64(config.salt),iterations:config.iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt']);
  documents=await readCatalog();
  try{sessionStorage.setItem(sessionName,JSON.stringify({raw:to64(await crypto.subtle.exportKey('raw',accessKey)),salt:config.salt,expires:Date.now()+8*60*60*1000}));}catch(err){}
  el('accessPassword').value='';await switchDoc(initialDoc(),true);
 }catch(err){accessKey=null;documents=null;showLogin(err.name==='OperationError'?'访问口令不正确，请重新输入。':err.message);}
 finally{el('unlockButton').disabled=false;el('unlockButton').textContent='进入课堂 →';}
});
(async()=>{
 try{
  const r=await fetch('./crypto-config.json',{cache:'no-store'});if(!r.ok)throw Error('访问配置加载失败，请刷新页面。');config=await r.json();el('unlockButton').disabled=false;el('unlockButton').textContent='进入课堂 →';
  let stored=null;try{stored=JSON.parse(sessionStorage.getItem(sessionName)||'null');}catch(err){}
  if(stored&&stored.expires>Date.now()&&stored.salt===config.salt){
   try{accessKey=await crypto.subtle.importKey('raw',from64(stored.raw),{name:'AES-GCM'},false,['decrypt']);documents=await readCatalog();await switchDoc(initialDoc(),true);return;}catch(err){try{sessionStorage.removeItem(sessionName);}catch(e){}}
  }
  showLogin();
 }catch(err){showLogin(err.message);el('unlockButton').disabled=true;}
})();
})();
