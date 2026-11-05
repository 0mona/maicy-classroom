'use strict';
window.mountClassroom=function(DATA,options={}){
const $=id=>document.getElementById(id),CW=1800;let CH=1120;
const life=new AbortController(),signal=life.signal;
const ink=document.createElement('canvas'),bg=document.createElement('canvas');
ink.width=bg.width=CW;ink.height=bg.height=CH;
const ctx=$('board').getContext('2d'),ic=ink.getContext('2d'),bc=bg.getContext('2d');
let states={},redoes={},undoes={},current=0,visible=[],tool='pen',color='#bd2929',penWidth=5;
let drawing=null,pan=null,draft=null,ready=false,token=0,toastTimer,raf=0,storageOK=true,destroyed=false;
const tablet=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>1;
let stylusOnly=tablet,penPointer=null,lastPenTime=0,customScale=1,pinch=null;
const touches=new Map();
try{const pref=localStorage.getItem('maicy-stylus-only');if(pref!==null)stylusOnly=pref==='true';}catch(e){}
const key=id=>'maicy-board-v1:'+DATA.id+':'+id;
const clone=v=>JSON.parse(JSON.stringify(v));
function validState(s){return !!s&&Array.isArray(s.strokes)&&s.strokes.length<30000&&s.strokes.every(a=>{
 if(!a||!['pen','eraser','text'].includes(a.tool)||!/^#[0-9a-f]{6}$/i.test(a.color)||!Number.isFinite(a.width)||a.width<=0||a.width>=100||!Array.isArray(a.points)||!a.points.length||a.points.length>=100000||!a.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))return false;
 return a.tool!=='text'||(typeof a.text==='string'&&a.text.length<=10000&&Number.isFinite(a.fontSize)&&a.fontSize>=16&&a.fontSize<=96&&Number.isFinite(a.maxWidth)&&a.maxWidth>=60&&a.maxWidth<=CW);
});}
for(const q of DATA.questions){let saved=null;try{saved=JSON.parse(localStorage.getItem(key(q.id))||'null');}catch(e){storageOK=false;}states[q.id]=validState(saved)?saved:{strokes:[],updatedAt:0};if(!states[q.id].layout)states[q.id].layout=states[q.id].strokes.length?'legacy':'full';}
const state=()=>states[DATA.questions[current].id];
function toast(s){$('toast').textContent=s;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(!destroyed)$('toast').hidden=true;},3000);}
function saveStatus(){const e=$('saveState');e.textContent=storageOK?'笔记已自动保留':'请导出笔记备份';e.title='笔记保存在当前浏览器，跨设备请导出备份。';e.style.color=storageOK?'#436349':'#a32626';}
function persist(){const q=DATA.questions[current],s=states[q.id];s.updatedAt=Date.now();try{localStorage.setItem(key(q.id),JSON.stringify(s));storageOK=true;}catch(e){storageOK=false;}saveStatus();drawList();buttons();}
function textLines(c,a){c.font=a.fontSize+'px "PingFang SC","Microsoft YaHei",Arial,sans-serif';const lines=[];for(const line of a.text.split('\n')){let row='';for(const char of line){if(row&&c.measureText(row+char).width>a.maxWidth){lines.push(row);row=char;}else row+=char;}lines.push(row);}return lines;}
function textBounds(a){const lines=textLines(ic,a);return {x:a.points[0][0]*CW,y:a.points[0][1]*CH,w:Math.min(a.maxWidth,Math.max(35,...lines.map(s=>ic.measureText(s).width))),h:Math.max(a.fontSize*1.45,lines.length*a.fontSize*1.45)};}
function strokePath(c,s){c.save();c.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';c.strokeStyle=c.fillStyle=s.color;
 if(s.tool==='text'){const x=s.points[0][0]*CW,y=s.points[0][1]*CH;c.textBaseline='top';const lines=textLines(c,s);lines.forEach((line,i)=>c.fillText(line,x,y+i*s.fontSize*1.45));c.restore();return;}
 c.lineWidth=s.width;c.lineCap=c.lineJoin='round';const p=s.points;if(p.length===1){c.beginPath();c.arc(p[0][0]*CW,p[0][1]*CH,s.width/2,0,Math.PI*2);c.fill();}else{c.beginPath();c.moveTo(p[0][0]*CW,p[0][1]*CH);for(let i=1;i<p.length;i++)c.lineTo(p[i][0]*CW,p[i][1]*CH);c.stroke();}c.restore();
}
function paint(){if(destroyed)return;ctx.clearRect(0,0,CW,CH);ctx.drawImage(bg,0,0);ctx.drawImage(ink,0,0);}
function schedulePaint(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;paint();});}
function redrawInk(){ic.clearRect(0,0,CW,CH);for(const s of state().strokes)strokePath(ic,s);paint();buttons();}
function buttons(){const id=DATA.questions[current].id;$('undo').disabled=!state().strokes.length&&!(undoes[id]?.length);$('redo').disabled=!(redoes[id]?.length);$('clear').disabled=!state().strokes.length;$('savePng').disabled=$('notesPng').disabled=!ready;}
function change(action){const id=DATA.questions[current].id,s=state().strokes;if(action.kind==='add')s.push(action.value);else if(action.kind==='replace')s[action.index]=action.value;else if(action.kind==='clear')states[id].strokes=[];(undoes[id]??=[]).push(action);if(undoes[id].length>80)undoes[id].shift();redoes[id]=[];persist();redrawInk();}
function finish(){if(!drawing)return;const value=drawing;drawing=null;change({kind:'add',index:state().strokes.length,value});}
function undo(){commitText();finish();const id=DATA.questions[current].id,s=state().strokes;let a=undoes[id]?.pop();if(!a&&s.length)a={kind:'add',index:s.length-1,value:s[s.length-1]};if(!a)return;if(a.kind==='add')s.splice(a.index,1);else if(a.kind==='replace')s[a.index]=a.before;else if(a.kind==='clear')states[id].strokes=clone(a.before);(redoes[id]??=[]).push(a);persist();redrawInk();}
function redo(){commitText();finish();const id=DATA.questions[current].id,a=redoes[id]?.pop();if(!a)return;const s=state().strokes;if(a.kind==='add')s.splice(a.index,0,a.value);else if(a.kind==='replace')s[a.index]=a.value;else if(a.kind==='clear')states[id].strokes=[];(undoes[id]??=[]).push(a);persist();redrawInk();}
function resize(){if(destroyed)return;const e=$('scroller'),v=$('zoom').value,aw=Math.max(240,e.clientWidth-34),ah=Math.max(150,e.clientHeight-34);const s=v==='custom'?customScale:v==='fit'?Math.min(aw/CW,ah/CH):aw/CW*(v==='width'?1:Number(v));$('board').style.width=Math.round(CW*s)+'px';$('board').style.height=Math.round(CH*s)+'px';}
function setTool(t){finish();if(t!=='text')commitText();tool=t;for(const n of ['pen','eraser','hand']){$(n).classList.toggle('active',t===n);$(n).setAttribute('aria-pressed',String(t===n));}$('textTool').classList.toggle('active',t==='text');$('textTool').setAttribute('aria-pressed',String(t==='text'));$('board').classList.toggle('hand',t==='hand');$('board').classList.toggle('text-tool',t==='text');}
function point(e){const b=$('board').getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))];}
function cancelText(){draft=null;$('textEditor').hidden=true;}
function commitText(){if(!draft)return;const d=draft,value=$('textValue').value.trim();draft=null;$('textEditor').hidden=true;if(!value)return;const annotation={tool:'text',color:$('textColor').value,width:5,points:[d.point],text:value,fontSize:Number($('textSize').value),maxWidth:Math.max(100,CW-d.point[0]*CW-30)};change(d.index===null?{kind:'add',index:state().strokes.length,value:annotation}:{kind:'replace',index:d.index,before:clone(state().strokes[d.index]),value:annotation});}
function beginText(e){commitText();const p=point(e),x=p[0]*CW,y=p[1]*CH;let index=null;for(let i=state().strokes.length-1;i>=0;i--){const a=state().strokes[i];if(a.tool!=='text')continue;const b=textBounds(a);if(x>=b.x-10&&x<=b.x+b.w+10&&y>=b.y-10&&y<=b.y+b.h+10){index=i;break;}}
 const old=index===null?null:state().strokes[index];draft={point:old?old.points[0]:[Math.min(.90,p[0]),Math.min(.90,p[1])],index};$('textValue').value=old?.text||'';$('textSize').value=String(old?.fontSize||36);$('textColor').value=old?.color||color;$('textEditorTitle').textContent=old?'编辑文字':'输入文字';const v=window.visualViewport,height=v?.height||innerHeight,width=Math.min(340,innerWidth-24);$('textEditor').style.left=Math.max(12,Math.min(e.clientX+8,innerWidth-width-12))+'px';$('textEditor').style.top=Math.max(12,Math.min(e.clientY+8,height-265))+'px';$('textEditor').hidden=false;$('textValue').focus();}
$('textDone').onclick=commitText;$('textCancel').onclick=cancelText;$('textValue').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancelText();}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();commitText();}});
function updateInputMode(){const b=$('stylusOnly');b.classList.toggle('active',stylusOnly);b.setAttribute('aria-pressed',String(stylusOnly));b.textContent=stylusOnly?'仅手写笔 ✓':'手指也可写';$('gestureHint').textContent=stylusOnly?'手写笔书写 · 手指拖动 · 双指缩放':'双指缩放 · 移动工具拖动画板';}
function midpoint(){const a=[...touches.values()];return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y))};}
function beginPinch(){finish();pan=null;const m=midpoint(),r=$('board').getBoundingClientRect();pinch={distance:m.d,scale:r.width/CW,x:(m.x-r.left)/r.width,y:(m.y-r.top)/r.height};}
function clearGesture(){pan=null;pinch=null;touches.clear();}
function capture(e){try{$('board').setPointerCapture(e.pointerId);}catch(err){}}
$('stylusOnly').onclick=()=>{finish();clearGesture();stylusOnly=!stylusOnly;try{localStorage.setItem('maicy-stylus-only',String(stylusOnly));}catch(e){}updateInputMode();};
$('board').addEventListener('pointerdown',e=>{
 if(!ready||e.button!==0)return;e.preventDefault();
 if(e.pointerType==='touch'){
  if(penPointer!==null||performance.now()-lastPenTime<500)return;
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});capture(e);
  if(touches.size>=2){beginPinch();return;}
  if(stylusOnly||tool==='hand'){pan={id:e.pointerId,x:e.clientX,y:e.clientY};return;}
 }
 if(e.pointerType==='pen'){finish();clearGesture();penPointer=e.pointerId;lastPenTime=performance.now();}
 if(tool==='hand'&&e.pointerType!=='pen'){pan={id:e.pointerId,x:e.clientX,y:e.clientY};capture(e);return;}
 if(tool==='text'){beginText(e);return;}
 if(drawing)return;
 drawing={tool:tool==='eraser'?'eraser':'pen',color,width:tool==='eraser'?penWidth*6:penWidth,points:[point(e)]};drawing.pointerId=e.pointerId;strokePath(ic,drawing);schedulePaint();capture(e);
},{passive:false});
$('board').addEventListener('pointermove',e=>{
 if(e.pointerType==='touch'&&!touches.has(e.pointerId))return;
 e.preventDefault();
 if(e.pointerType==='touch'){
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touches.size>=2&&pinch){const m=midpoint();customScale=Math.max(.18,Math.min(2.5,pinch.scale*m.d/pinch.distance));$('zoom').value='custom';resize();const r=$('board').getBoundingClientRect();$('scroller').scrollLeft+=r.left+pinch.x*r.width-m.x;$('scroller').scrollTop+=r.top+pinch.y*r.height-m.y;return;}
 }
 if(pan&&pan.id===e.pointerId){$('scroller').scrollLeft+=pan.x-e.clientX;$('scroller').scrollTop+=pan.y-e.clientY;pan.x=e.clientX;pan.y=e.clientY;return;}
 if(!drawing||drawing.pointerId!==e.pointerId)return;
 const events=e.getCoalescedEvents?.();for(const ev of(events?.length?events:[e])){const p=point(ev),last=drawing.points.at(-1);if(Math.hypot((p[0]-last[0])*CW,(p[1]-last[1])*CH)<.7)continue;drawing.points.push(p);strokePath(ic,{...drawing,points:[last,p]});}schedulePaint();
},{passive:false});
function endPointer(e){
 if(e.pointerId===penPointer){lastPenTime=performance.now();penPointer=null;}
 if(drawing?.pointerId===e.pointerId)finish();
 touches.delete(e.pointerId);if(pan?.id===e.pointerId)pan=null;
 if(touches.size<2){pinch=null;if(touches.size===1){const [id,t]=[...touches][0];pan={id,x:t.x,y:t.y};}}
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('board').addEventListener(event,endPointer);
for(const name of ['contextmenu','selectstart','dragstart'])$('scroller').addEventListener(name,e=>e.preventDefault(),{signal});
function focusBoard(on){document.body.classList.toggle('board-focus',on);$('focusBoard').textContent=on?'退出专注':'专注讲题';$('focusBoard').setAttribute('aria-pressed',String(on));requestAnimationFrame(resize);}
$('focusBoard').onclick=()=>focusBoard(!document.body.classList.contains('board-focus'));
$('boardMenu').onclick=()=>document.body.classList.toggle('menu');
updateInputMode();
function openQuestion(i){commitText();finish();clearGesture();current=i;CH=state().layout==='legacy'?1120:2400;ink.height=bg.height=$('board').height=CH;ready=false;const q=DATA.questions[i],v=++token;$('overview').hidden=true;$('workspace').hidden=false;document.body.classList.remove('menu');$('questionTitle').textContent=q.title;$('questionMeta').textContent=q.meta;$('originalButtons').replaceChildren();for(const p of q.originalPages){const b=document.createElement('button');b.textContent='原卷第'+p+'页';b.onclick=()=>showOriginal(p);$('originalButtons').append(b);}if(tablet)focusBoard(true);position();drawList();$('scroller').scrollTo(0,0);bc.fillStyle='#fff';bc.fillRect(0,0,CW,CH);bc.fillStyle='#536479';bc.font='24px sans-serif';bc.fillText('正在载入题目…',60,80);ic.clearRect(0,0,CW,CH);paint();resize();buttons();const img=new Image();img.onload=()=>{if(destroyed||v!==token)return;bc.fillStyle='#fff';bc.fillRect(0,0,CW,CH);if(state().layout==='legacy'){const left=1140,pad=34,scale=Math.min((left-pad*2)/img.width,(CH-pad*2)/img.height);bc.drawImage(img,pad+(left-pad*2-img.width*scale)/2,pad+(CH-pad*2-img.height*scale)/2,img.width*scale,img.height*scale);bc.fillStyle='#f5f8fc';bc.fillRect(left,0,CW-left,CH);bc.strokeStyle='#c9d5e4';bc.lineWidth=2;bc.beginPath();bc.moveTo(left,0);bc.lineTo(left,CH);bc.stroke();bc.fillStyle='#174b89';bc.font='bold 29px "PingFang SC","Microsoft YaHei",sans-serif';bc.fillText('讲解笔记',left+32,56);bc.font='18px sans-serif';bc.fillStyle='#66778b';bc.fillText('整张画板均可手写',left+32,88);bc.strokeStyle='#dde5ee';bc.lineWidth=1;for(let y=135;y<CH;y+=48){bc.beginPath();bc.moveTo(left+30,y);bc.lineTo(CW-30,y);bc.stroke();}}else{const pad=40,scale=Math.min((CW-pad*2)/img.width,(CH-480)/img.height);bc.drawImage(img,pad,pad,img.width*scale,img.height*scale);}ready=true;redrawInk();resize();};img.onerror=()=>{if(!destroyed&&v===token)toast('图片加载失败，请重新选择题目。');};window.resolveProtectedImage(q.image).then(url=>{if(!destroyed&&v===token)img.src=url;}).catch(()=>{if(!destroyed)toast('图片加载失败，请重试。');});}
async function showOriginal(p){try{$('originalTitle').textContent='原卷第'+p+'页 · 参考原件';$('originalImage').removeAttribute('src');$('originalDialog').showModal();$('originalImage').src=await window.resolveProtectedImage(DATA.originals[p]);}catch(e){if(!destroyed)toast('原页加载失败，请重试。');}}
function position(){const n=visible.indexOf(current);$('position').textContent=(n+1)+' / '+visible.length+' 项';$('prev').disabled=n<=0;$('next').disabled=n>=visible.length-1;}
function drawList(){const list=$('list'),scroll=list.scrollTop;list.replaceChildren();for(const i of visible){const q=DATA.questions[i],b=document.createElement('button');b.className='item'+(!$('workspace').hidden&&current===i?' current':'');const strong=document.createElement('strong');if(states[q.id].strokes.length){const dot=document.createElement('span');dot.className='dot';dot.title='已有笔记';strong.append(dot);}strong.append(document.createTextNode(q.title));const small=document.createElement('small'),book=q.meta.match(/(?:教材|印刷)(\d+)页/);small.textContent='原'+q.originalPages.join('、')+'页'+(book?' · '+book[1]+'页':'');b.title=q.meta;b.append(strong,small);b.onclick=()=>openQuestion(i);list.append(b);}list.scrollTop=scroll;$('listCount').textContent='题目目录 · '+visible.length+'项';}
function filter(){const cat=$('category').value,term=$('search').value.trim().toLowerCase();visible=DATA.questions.flatMap((q,i)=>(cat==='*'||q.categories.includes(cat))&&(!term||(q.title+' '+q.meta+' '+q.categories.join(' ')).toLowerCase().includes(term))?[i]:[]);drawList();if(!$('workspace').hidden){if(visible.includes(current))position();else home();}}
function home(){commitText();finish();clearGesture();focusBoard(false);$('overview').hidden=false;$('workspace').hidden=true;document.body.classList.remove('menu');drawList();}
function go(delta){const n=visible.indexOf(current)+delta;if(n>=0&&n<visible.length)openQuestion(visible[n]);}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const stamp=()=>new Date().toLocaleDateString('sv-SE');
function snapshot(){commitText();finish();return {schema:1,documentId:DATA.id,updatedAt:Date.now(),states};}
function saveNotes(){commitText();finish();persist();$('saveDialog').close();toast('笔记已保存在当前浏览器。');}
$('pen').onclick=()=>setTool('pen');$('textTool').onclick=()=>setTool('text');$('eraser').onclick=()=>setTool('eraser');$('hand').onclick=()=>setTool('hand');$('undo').onclick=undo;$('redo').onclick=redo;
$('clear').onclick=()=>{commitText();finish();if(confirm('清除本题全部新增笔迹和文字？原题和原批改会保留。'))change({kind:'clear',before:clone(state().strokes)});};
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(c=>c.classList.toggle('selected',c===b));if(tool==='text'){if(draft)$('textColor').value=color;}else setTool('pen');});
$('width').onchange=e=>penWidth=Number(e.target.value);$('zoom').onchange=()=>{clearGesture();resize();$('scroller').scrollTo(0,0);};$('prev').onclick=()=>go(-1);$('next').onclick=()=>go(1);$('home').onclick=home;$('category').onchange=filter;$('search').oninput=filter;$('menuButton').onclick=()=>document.body.classList.toggle('menu');
$('save').onclick=()=>{commitText();finish();buttons();$('saveDialog').showModal();};$('closeSave').onclick=()=>$('saveDialog').close();$('closeOriginal').onclick=()=>{$('originalDialog').close();$('originalImage').removeAttribute('src');};$('saveHtml').onclick=saveNotes;
$('saveJson').onclick=()=>{download(new Blob([JSON.stringify(snapshot())],{type:'application/json'}),DATA.title+'｜笔记备份_'+stamp()+'.json');toast('已下载全部笔记备份');};
$('savePng').onclick=()=>{commitText();finish();paint();$('board').toBlob(b=>{if(b)download(b,DATA.title+'｜'+DATA.questions[current].title.replace(/[\\/:*?"<>|]/g,'_')+'.png');},'image/png');};
$('notesExport').onclick=()=>{$('notesMenu').open=false;$('saveJson').click();};$('notesPng').onclick=()=>{$('notesMenu').open=false;$('savePng').click();};
$('import').onclick=()=>{$('notesMenu').open=false;$('importFile').click();};$('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>50000000)throw Error('备份过大');const s=JSON.parse(await f.text());if(s.schema!==1||s.documentId!==DATA.id||!s.states)throw Error('不是这份材料的笔记备份');const entries=Object.entries(s.states);if(!entries.every(([id,v])=>DATA.questions.some(q=>q.id===id)&&validState(v)))throw Error('笔记格式不完整');if(!confirm('导入备份将替换对应题目的现有笔记，是否继续？'))return;cancelText();for(const [id,v] of entries){states[id]=v;if(!states[id].layout)states[id].layout=states[id].strokes.length?'legacy':'full';states[id].updatedAt=Date.now();try{localStorage.setItem(key(id),JSON.stringify(states[id]));}catch(err){storageOK=false;}}redoes={};undoes={};drawList();if(!$('workspace').hidden)openQuestion(current);saveStatus();toast('已导入笔记备份');}catch(err){toast('导入失败：'+err.message);}finally{e.target.value='';}};
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)||$('saveDialog').open||$('originalDialog').open)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNotes();}if(!$('workspace').hidden&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}},{signal});
window.addEventListener('blur',()=>{finish();clearGesture();penPointer=null;},{signal});window.addEventListener('resize',resize,{signal});window.addEventListener('pagehide',()=>{commitText();finish();},{signal});
const headerObserver=new ResizeObserver(()=>{document.documentElement.style.setProperty('--header-h',$('appHeader').getBoundingClientRect().height+'px');resize();});headerObserver.observe($('appHeader'));
$('switchMaterial').onclick=()=>{commitText();finish();window.showMaterialChooser();};$('logout').onclick=()=>{commitText();finish();window.lockClassroom();};
$('appTitle').textContent='Maicy 数学讲题画板';$('activeMaterial').textContent=options.docKey==='exam'?'第四、六单元试卷':'同步练习';document.title=DATA.title+'｜讲题画板';$('overviewTitle').textContent=DATA.title;
const docs=options.documents||[];$('fileCount').textContent=docs.length;$('fileAreaCount').textContent='本文件 '+DATA.questions.length+(options.docKey==='exam'?'项':'题');$('materialNav').replaceChildren();
for(const d of docs){const b=document.createElement('button');b.className='material-tab'+(d.key===options.docKey?' selected':'');b.dataset.doc=d.key;const name=document.createElement('span'),n=document.createElement('small');name.textContent=d.name;n.textContent=d.count+(d.key==='exam'?'项':'题');b.append(name,n);b.onclick=()=>window.changeClassroomMaterial(d.key);$('materialNav').append(b);}
$('fileSummary').textContent=Object.keys(DATA.originals).length+'页原卷 · '+(options.docKey==='exam'?'23处标错，另有8处空缺／关注':'93条确认错项');
const all=document.createElement('option');all.value='*';all.textContent='全部知识点';$('category').replaceChildren(all);$('tiles').replaceChildren();
for(const cat of DATA.categories){const o=document.createElement('option');o.value=cat.id;o.textContent=cat.name;$('category').append(o);const b=document.createElement('button');b.className='tile';const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=cat.name;small.textContent=cat.description;b.append(strong,small);b.onclick=()=>{$('category').value=cat.id;$('search').value='';filter();if(visible.length)openQuestion(visible[0]);};$('tiles').append(b);}
$('metrics').replaceChildren();for(const m of DATA.metrics){const d=document.createElement('div');d.className='metric';const a=document.createElement('strong'),b=document.createElement('span');a.textContent=m.value;b.textContent=m.label;d.append(a,b);$('metrics').append(d);}
$('start').onclick=()=>{if(visible.length)openQuestion(visible[0]);};$('width').value='5';$('zoom').value=options.view?.zoom||'width';const view=options.view;
if(view&&Array.from($('category').options).some(o=>o.value===view.category))$('category').value=view.category;$('search').value=view?.search||'';
filter();setTool('pen');saveStatus();home();buttons();if(view?.workspace&&visible.includes(view.current))openQuestion(view.current);
return {
 snapshot,
 captureView:()=>({current,category:$('category').value,search:$('search').value,workspace:!$('workspace').hidden,zoom:$('zoom').value}),
 inspect:()=>({documentId:DATA.id,questionCount:DATA.questions.length,current,ready,strokes:clone(state().strokes),visible:visible.length,tool,stylusOnly,layout:state().layout}),
 destroy:()=>{commitText();finish();clearGesture();document.body.classList.remove('board-focus');token++;destroyed=true;life.abort();headerObserver.disconnect();clearTimeout(toastTimer);if(raf)cancelAnimationFrame(raf);}
};
};
