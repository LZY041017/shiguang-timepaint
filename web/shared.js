export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const names = {study:'考研', rest:'休息', other:'杂项', empty:'未安排'};
export const colors = {study:'#b3c7a0', rest:'#e5b77e', other:'#aaa9ca', empty:'#eff0e8'};
export const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
export const store = {state:null, week:null, selected:null, view:'week'};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const duration = n => n === 0 ? '0 分钟' : `${Math.floor(n/60) ? Math.floor(n/60)+' 小时' : ''}${n%60 ? ' '+(n%60)+' 分钟' : ''}`.trim();
export const hours = n => (n/60).toFixed(1).replace(/\.0$/,'');
export function dateKey(d = new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function asDate(s){const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12);}
export function addDays(s,n){const d=asDate(s); d.setDate(d.getDate()+n); return dateKey(d);}
export function monday(s){const d=asDate(s); return addDays(s,-((d.getDay()+6)%7));}
export function dayTitle(s){const d=asDate(s); return `${d.getMonth()+1} 月 ${d.getDate()} 日 · ${weekdays[d.getDay()]}`;}
export function totals(date){const result={study:0,rest:0,other:0,empty:1440}; for(const e of store.state.events) if(e.date===date){const n=e.end-e.start;result[e.category]+=n;result.empty-=n;} return result;}
export function eventsFor(date){return store.state.events.filter(e=>e.date===date).sort((a,b)=>a.start-b.start);}
export function donut(t,small=false){let n=0;const stops=Object.keys(names).map(k=>{const start=n;n+=t[k]/1440*100;return `${colors[k]} ${start}% ${n}%`;});return `<div class="donut" style="background:conic-gradient(${stops.join(',')})" role="img" aria-label="${Object.entries(t).map(([k,v])=>names[k]+duration(v)).join('，')}"><div class="donut-center"><strong>${hours(1440-t.empty)}<span style="font-size:${small?'9':'12'}px;letter-spacing:0;margin-left:3px">h</span></strong><small>已安排 / 24 小时</small></div></div>`;}
export function legend(t){return Object.keys(names).map(k=>`<div class="legend-row"><i class="legend-dot ${k}"></i><span>${names[k]}</span><strong>${duration(t[k])}</strong><small>${(t[k]/1440*100).toFixed(1)}%</small></div>`).join('');}
const paths = {
calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
chart:'<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15Z"/>',
book:'<path d="M12 5v16m0-16C8 2 3 4 3 4v15s5-2 9 2c4-4 9-2 9-2V4s-5-2-9 1Z"/>',
download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
plus:'<path d="M12 5v14M5 12h14"/>',sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
'chevron-left':'<path d="m14 6-6 6 6 6"/>','chevron-right':'<path d="m10 6 6 6-6 6"/>','arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
undo:'<path d="M3 10h11a7 7 0 0 1 0 14M7 5l-5 5 5 5" transform="translate(1 -3)"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
x:'<path d="m6 6 12 12M6 18 18 6"/>',coffee:'<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm13 1h2a3 3 0 0 1 0 6h-2M3 22h17M7 2v3m5-3v3"/>',
sliders:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-5 4 3 3-4 5 6"/>',
trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',check:'<path d="m5 12 4 4L19 6"/>'
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.sparkles}</svg>`;
export function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
export function toast(message,undo=false){const el=$('#toast');clearTimeout(toast.timer);el.innerHTML=`<span>${esc(message)}</span>${undo?'<button id="toastUndo">撤销</button>':''}`;el.hidden=false;if(undo)$('#toastUndo').onclick=()=>mutate('/api/undo',{}).then(()=>toast('已撤销上一步')).catch(errorToast);toast.timer=setTimeout(()=>el.hidden=true,5000);}
export function errorToast(error){toast(error.message||'操作失败，请重试');}
export async function api(path,body){const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-TimePaint-Token':store.state.token},body:JSON.stringify(body)};let response;try{response=await fetch(path,options);}catch{throw new Error('本地服务暂时断开，请重新打开时光涂涂；已保存的记录仍在本机。');}const data=await response.json();if(!response.ok)throw new Error(data.error||'操作失败');return data;}
export async function mutate(path,body){$('#savedStatus').textContent='正在保存…';try{const result=await api(path,{...body,revision:store.state.revision});store.state=result;document.dispatchEvent(new Event('statechange'));$('#savedStatus').innerHTML='<span class="status-dot"></span>已保存到本地';return result;}catch(error){$('#savedStatus').textContent='保存未完成';throw error;}}
export async function reload(){store.state=await api('/api/state');document.dispatchEvent(new Event('statechange'));$('#savedStatus').innerHTML='<span class="status-dot"></span>已保存到本地';}
let returnFocus;
export function openModal(title,html,wide=false){returnFocus=document.activeElement;$('#modalTitle').textContent=title;$('#modalContent').innerHTML=html;$('.modal').classList.toggle('lightbox',wide);$('#modalOverlay').hidden=false;icons($('#modalContent'));$('#closeModal').focus();}
export function closeModal(){$('#modalOverlay').hidden=true;returnFocus?.focus();}
export function confirmAction(title,message,action,label='确认'){openModal(title,`<p>${esc(message)}</p><div id="modalError" class="form-error"></div><div class="modal-actions"><button class="secondary" id="modalCancel">取消</button><button class="primary" id="modalConfirm">${esc(label)}</button></div>`);$('#modalCancel').onclick=closeModal;$('#modalConfirm').onclick=async()=>{const btn=$('#modalConfirm');btn.disabled=true;try{await action();closeModal();}catch(e){$('#modalError').textContent=e.message;btn.disabled=false;}};}
export function lightbox(name){openModal('图片记忆',`<img src="/media/${esc(name)}" alt="事件图片原图">`,true);}
export function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
