import {$,$$,store,esc,fmt,duration,dateKey,addDays,api,mutate,toast,errorToast,icons,confirmAction,lightbox} from './shared.js';

let editing=null,category='study',images=[],original='',uploading=0,returnFocus;
function formSnapshot(){return JSON.stringify({title:$('#eventTitle').value,date:$('#eventDate').value,start:$('#startTime').value,end:$('#endTime').value,note:$('#eventNote').value,category,images});}
function parseTime(value,ending=false){
  const match=/^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if(!match)throw new Error('时间请写成 HH:MM，例如 08:30');
  const h=+match[1],m=+match[2];
  if(h>24||m>59||(h===24&&(!ending||m!==0)))throw new Error('开始时间为 00:00–23:59，结束时间可到 24:00');
  return h*60+m;
}
export function openEditor(event={}){
  returnFocus=document.activeElement;editing=event.id||null;category=event.category||'study';images=[...(event.images||[])];
  $('#editorTitle').textContent=editing?'编辑这段时光':'记录一段时光';
  $('#eventTitle').value=event.title||'';$('#eventDate').value=event.date||dateKey();
  $('#startTime').value=fmt(event.start??480);$('#endTime').value=fmt(event.end??525);
  $('#eventNote').value=event.note||'';$('#deleteBtn').hidden=!editing;
  $('#wheelArea').hidden=true;$('#toggleWheels').firstChild.textContent='使用时间滚轮';
  $('#formError').textContent='';$('#saveEvent').disabled=false;
  $('#drawerOverlay').hidden=false;$('.drawer-scroll').scrollTop=0;
  paintCategory();renderImages();updateHint();original=formSnapshot();
  setTimeout(()=>$('#eventTitle').focus(),80);
}
function hideEditor(){$('#drawerOverlay').hidden=true;$('#startWheels').innerHTML='';$('#endWheels').innerHTML='';returnFocus?.focus();}
export function closeEditor(){
  if(uploading){toast('图片正在保存，请稍等');return;}
  if(formSnapshot()!==original){confirmAction('保留这次编辑？','这段时光还没有保存。继续退出会丢弃当前编辑，已保存的记录不会改变。',async()=>hideEditor(),'放弃编辑');}else hideEditor();
}
function paintCategory(){$$('.category-picker button').forEach(b=>b.classList.toggle('selected',b.dataset.category===category));}
function updateHint(){
  try{
    const a=parseTime($('#startTime').value),b=parseTime($('#endTime').value,true);
    if(a===b)throw new Error('起止时间不能相同；全天请选择 00:00–24:00');
    const overnight=b<a,minutes=overnight?1440-a+b:b-a;
    $('#durationHint').textContent=`共 ${duration(minutes)}${overnight?' · 跨午夜，自动分配到今天和次日':''}`;
    const day=$('#eventDate').value;
    const parts=overnight?[{date:day,start:a,end:1440},{date:addDays(day,1),start:0,end:b}]:[{date:day,start:a,end:b}];
    let overlap=0;
    for(const part of parts)for(const e of store.state.events)if(e.id!==editing&&e.date===part.date)overlap+=Math.max(0,Math.min(e.end,part.end)-Math.max(e.start,part.start));
    $('#overlapHint').hidden=!overlap;$('#overlapHint').textContent=`将覆盖已有安排中的 ${duration(overlap)}。两侧未覆盖部分会保留，保存后可撤销。`;
    $('#durationHint').style.color='';
  }catch(e){$('#durationHint').textContent=e.message;$('#durationHint').style.color='#b27b5a';$('#overlapHint').hidden=true;}
}
function renderImages(){
  $('#imageGrid').innerHTML=images.map((name,i)=>`<div class="image-item"><img src="/media/${esc(name)}" alt="事件附件 ${i+1}" tabindex="0" data-image="${esc(name)}"><button type="button" data-remove="${i}" aria-label="移除第${i+1}张图片">×</button></div>`).join('');
  $$('#imageGrid [data-remove]').forEach(b=>b.onclick=()=>{images.splice(+b.dataset.remove,1);renderImages();});
  $$('#imageGrid [data-image]').forEach(img=>{img.onclick=()=>lightbox(img.dataset.image);img.onkeydown=e=>{if(e.key==='Enter')lightbox(img.dataset.image);};});
  $('#uploadZone').hidden=images.length>=6;
}
async function addImages(files){
  if(uploading)return;
  if(images.length+files.length>6){toast('一段时光最多添加 6 张图片');return;}
  uploading++;$('#saveEvent').disabled=true;$('#formError').textContent='正在保存图片…';
  try{
    for(const file of files){
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
      if(file.size>8*1024*1024)throw new Error('单张图片不能超过 8 MB');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
      const result=await api('/api/upload',{data:encoded});images.push(result.name);renderImages();
    }
    $('#formError').textContent='';
  }catch(e){$('#formError').textContent=e.message;}finally{uploading--;$('#saveEvent').disabled=false;$('#imageInput').value='';}
}
function makeWheel(parent,values,current,change,label){
  const wheel=document.createElement('div');wheel.className='wheel';wheel.setAttribute('role','listbox');wheel.setAttribute('aria-label',label);wheel.tabIndex=0;
  wheel.innerHTML=values.map(v=>`<div class="wheel-option ${v===current?'selected':''}" role="option" aria-selected="${v===current}" data-value="${v}">${String(v).padStart(2,'0')}</div>`).join('');
  parent.append(wheel);let index=Math.max(0,values.indexOf(current)),timer;
  const update=()=>{if(!wheel.isConnected||$('#wheelArea').hidden)return;const next=Math.max(0,Math.min(values.length-1,Math.round(wheel.scrollTop/32)));index=next;[...wheel.children].forEach((el,i)=>{el.classList.toggle('selected',i===next);el.setAttribute('aria-selected',String(i===next));});change(values[next]);};
  wheel.commit=update;
  wheel.scrollTop=index*32;
  wheel.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(update,75);});
  wheel.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?values.length-1:index+(e.key==='ArrowDown'?1:-1);wheel.scrollTop=Math.max(0,Math.min(values.length-1,next))*32;update();}};
  wheel.onclick=e=>{const el=e.target.closest('[data-value]');if(el){wheel.scrollTo({top:values.indexOf(+el.dataset.value)*32,behavior:'smooth'});}};
  wheel.onpointerdown=e=>{
    if(e.pointerType==='touch')return;
    const y=e.clientY,top=wheel.scrollTop;let dragged=false;wheel.classList.add('dragging');wheel.setPointerCapture(e.pointerId);
    wheel.onpointermove=move=>{if(Math.abs(move.clientY-y)>3){dragged=true;wheel.scrollTop=top+y-move.clientY;}};
    const finish=()=>{wheel.classList.remove('dragging');wheel.onpointermove=null;wheel.onpointerup=null;wheel.onpointercancel=null;if(dragged){wheel.scrollTop=Math.round(wheel.scrollTop/32)*32;update();wheel.addEventListener('click',ev=>ev.stopImmediatePropagation(),{once:true,capture:true});}};
    wheel.onpointerup=finish;wheel.onpointercancel=finish;
  };
}
function buildWheels(){
  for(const [kind,ending] of [['start',false],['end',true]]){
    const parent=$('#'+kind+'Wheels');parent.innerHTML='';let value;
    try{value=parseTime($('#'+kind+'Time').value,ending);}catch{value=ending?525:480;}
    let h=Math.floor(value/60),m=value%60;
    const sync=()=>{if(h===24)m=0;$('#'+kind+'Time').value=fmt(h*60+m);updateHint();};
    makeWheel(parent,Array.from({length:ending?25:24},(_,i)=>i),h,v=>{h=v;sync();if(h===24){const minuteWheel=parent.children[1];if(minuteWheel)minuteWheel.scrollTop=0;}},(ending?'结束':'开始')+'小时滚轮');
    makeWheel(parent,Array.from({length:60},(_,i)=>i),m,v=>{m=v;if(h===24&&m!==0){h=23;parent.children[0].scrollTop=23*32;}sync();},(ending?'结束':'开始')+'分钟滚轮');
  }
}
export function initEditor(){
  $('#closeEditor').onclick=closeEditor;$('#cancelEditor').onclick=closeEditor;
  $('#drawerOverlay').onclick=e=>{if(e.target.id==='drawerOverlay')closeEditor();};
  $$('.category-picker button').forEach(b=>b.onclick=()=>{category=b.dataset.category;paintCategory();});
  $('#eventDate').addEventListener('input',updateHint);
  for(const s of ['#startTime','#endTime'])$(s).addEventListener('input',()=>{
    // 直接键入时间时销毁旧滚轮，避免其延迟滚动回调改写输入。
    $('#wheelArea').hidden=true;$('#startWheels').innerHTML='';$('#endWheels').innerHTML='';
    $('#toggleWheels').firstChild.textContent='使用时间滚轮';updateHint();
  });
  $('#toggleWheels').onclick=()=>{const area=$('#wheelArea');if(!area.hidden)$$('.wheel').forEach(w=>w.commit());area.hidden=!area.hidden;$('#toggleWheels').firstChild.textContent=area.hidden?'使用时间滚轮':'收起时间滚轮';if(!area.hidden)buildWheels();};
  $('#imageInput').onchange=e=>addImages([...e.target.files]);
  $('#uploadZone').ondragover=e=>{e.preventDefault();$('#uploadZone').classList.add('dragover');};
  $('#uploadZone').ondragleave=()=>$('#uploadZone').classList.remove('dragover');
  $('#uploadZone').ondrop=e=>{e.preventDefault();$('#uploadZone').classList.remove('dragover');addImages([...e.dataTransfer.files]);};
  $('#eventForm').onsubmit=async e=>{
    e.preventDefault();if(uploading)return;if(!$('#wheelArea').hidden)$$('.wheel').forEach(w=>w.commit());$('#saveEvent').disabled=true;$('#formError').textContent='';
    try{
      const start=parseTime($('#startTime').value),end=parseTime($('#endTime').value,true);
      if(start===end)throw new Error('起止时间不能相同');
      await mutate('/api/event',{id:editing,title:$('#eventTitle').value.trim(),date:$('#eventDate').value,start,end,category,note:$('#eventNote').value,images});
      hideEditor();toast('这段时光，已经好好收下了。',true);
    }catch(error){$('#formError').textContent=error.message;}finally{$('#saveEvent').disabled=false;}
  };
  $('#deleteBtn').onclick=()=>confirmAction('删除这段时光？','删除后这段时间将恢复空白，可使用撤销找回。',async()=>{await mutate('/api/delete',{id:editing});hideEditor();toast('已删除这段记录',true);},'删除记录');
}
