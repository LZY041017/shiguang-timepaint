import {$,$$,store,esc,fmt,duration,hours,dateKey,asDate,addDays,monday,dayTitle,weekdays,names,totals,eventsFor,donut,legend,icons,icon,api,mutate,reload,toast,errorToast,closeModal} from './shared.js';
import {openEditor,closeEditor,initEditor} from './editor.js';
import {openTemplate,openBackup,openCopy} from './manage.js';

store.week=monday(dateKey());store.selected=dateKey();
let didScroll=false;
function renderWeek(){
  const scroll=$('#calendarScroll').scrollTop;
  const start=asDate(store.week),end=asDate(addDays(store.week,6));
  $('#weekLabel').textContent=`${start.getFullYear()} 年 ${start.getMonth()+1}.${String(start.getDate()).padStart(2,'0')} – ${end.getMonth()+1}.${String(end.getDate()).padStart(2,'0')}`;
  $('#weekNumber').textContent=store.week===monday(dateKey())?'本周':'第 '+Math.ceil(((start-new Date(start.getFullYear(),0,1))/86400000+1)/7)+' 周';
  const days=Array.from({length:7},(_,i)=>addDays(store.week,i));
  $('#dayHeaders').innerHTML=days.map((day,i)=>`<button class="day-header ${day===dateKey()?'today':''} ${day===store.selected?'selected':''}" data-day="${day}" aria-label="查看${day}的安排"><span>${weekdays[(i+1)%7]}</span><strong>${String(asDate(day).getDate()).padStart(2,'0')}</strong></button>`).join('');
  $('#timeAxis').innerHTML=Array.from({length:25},(_,h)=>`<span class="time-label" style="top:${h*60}px">${String(h).padStart(2,'0')}:00</span>`).join('');
  $('#dayColumns').innerHTML=days.map(day=>`<div class="day-column ${day===store.selected?'selected':''}" data-day="${day}" aria-label="${day}时间画布">${store.state.slots.map(s=>`<div class="template-slot" style="top:${s.start}px;height:${s.end-s.start}px"><span>${fmt(s.start)}</span></div>`).join('')}${eventsFor(day).map(e=>{const d=e.end-e.start;return `<button class="event-block ${e.category} ${d<32?'compact':''}" style="top:${e.start}px;height:${d}px" data-event="${esc(e.id)}" title="${esc(e.title)} · ${fmt(e.start)}–${fmt(e.end)} · ${names[e.category]}" aria-label="编辑 ${esc(e.title)} ${fmt(e.start)}至${fmt(e.end)}"><span class="event-title">${e.images?.length?'<span class="event-photo-mark">▧</span>':''}${esc(e.title)}</span>${d>=32?`<span class="event-time">${fmt(e.start)} – ${fmt(e.end)}</span>`:''}${d>=75&&e.note?`<span class="event-note">${esc(e.note)}</span>`:''}</button>`;}).join('')}${nowLine(day)}</div>`).join('');
  $$('.day-header').forEach(btn=>btn.onclick=()=>selectDay(btn.dataset.day));
  $$('.event-block').forEach(btn=>{btn.onpointerdown=e=>e.stopPropagation();btn.onclick=()=>openEditor(store.state.events.find(e=>e.id===btn.dataset.event));});
  $$('.day-column').forEach(bindCanvas);
  $('#calendarScroll').scrollTop=didScroll?scroll:450;didScroll=true;
  $('#templateStatus').textContent=`时间格来自 ${store.state.templateName} · 每日 ${store.state.slots.length} 段`;
  $('#undoBtn').disabled=!store.state.canUndo;
  renderDayPanel();
}
function nowLine(day){if(day!==dateKey())return '';const now=new Date();return `<div class="now-line" style="top:${now.getHours()*60+now.getMinutes()}px" title="当前时间"></div>`;}
function selectDay(day){store.selected=day;$('#statsDate').value=day;renderWeek();if(store.view==='stats')renderStats();}
function renderDayPanel(){
  const t=totals(store.selected),events=eventsFor(store.selected);
  $('#selectedDayLabel').textContent=dayTitle(store.selected)+(store.selected===dateKey()?' · 今天':'');
  $('#dailyDonut').innerHTML=donut(t);$('#dailyLegend').innerHTML=legend(t);
  $('#eventCount').textContent=`${events.length} 段时光`;
  $('#dayEventList').innerHTML=events.length?events.map(e=>`<button class="day-list-item" data-id="${esc(e.id)}"><i class="legend-dot ${e.category}"></i><span><b>${esc(e.title)}</b><small>${fmt(e.start)} – ${fmt(e.end)}</small></span></button>`).join(''):'<div class="empty-day"><span class="empty-flower">✳</span>今天还是一张空白画布<br>从第一笔开始吧。</div>';
  $$('.day-list-item').forEach(btn=>btn.onclick=()=>openEditor(store.state.events.find(e=>e.id===btn.dataset.id)));
}
function bindCanvas(column){
  column.onpointerdown=event=>{
    if(event.button!==0||event.target.closest('.event-block'))return;
    const day=column.dataset.day;
    const minuteAt=y=>Math.max(0,Math.min(1440,Math.round((y-column.getBoundingClientRect().top)/5)*5));
    const initial=minuteAt(event.clientY);let current=initial,moved=false;
    const preview=document.createElement('div');preview.className='selection-preview';column.append(preview);
    column.setPointerCapture(event.pointerId);
    const draw=()=>{const a=Math.min(initial,current),b=Math.max(initial,current);preview.style.top=a+'px';preview.style.height=Math.max(5,b-a)+'px';preview.textContent=`${fmt(a)} – ${fmt(b)}`;};
    column.onpointermove=e=>{current=minuteAt(e.clientY);if(Math.abs(current-initial)>=5)moved=true;if(moved){const rect=$('#calendarScroll').getBoundingClientRect();if(e.clientY>rect.bottom-25)$('#calendarScroll').scrollTop+=12;if(e.clientY<rect.top+25)$('#calendarScroll').scrollTop-=12;draw();}};
    const clear=()=>{preview.remove();column.onpointermove=null;column.onpointerup=null;column.onpointercancel=null;};
    column.onpointercancel=clear;
    column.onpointerup=e=>{column.releasePointerCapture(e.pointerId);clear();store.selected=day;let a,b;if(moved){a=Math.min(initial,current);b=Math.max(initial,current);}else{const slot=store.state.slots.find(s=>s.start<=initial&&initial<s.end);a=slot?.start??Math.min(1410,Math.floor(initial/30)*30);b=slot?.end??a+30;}if(a===b)return;openEditor({date:day,start:a,end:b,category:'study',title:'',note:'',images:[]});renderDayPanel();};
  };
}
export function showView(view){store.view=view;$$('.page').forEach(p=>p.classList.toggle('active',p.id===view+'View'));$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#viewLabel').textContent={week:'周课表',stats:'每日统计',guide:'使用指南'}[view];if(view==='stats')renderStats();window.scrollTo(0,0);}
function renderStats(){
  $('#statsDate').value=store.selected;
  const day=store.selected,t=totals(day),events=eventsFor(day),first=monday(day);
  const reportLabel=day<dateKey()?'已归档':day===dateKey()?'今日 · 实时更新':'未来安排';
  const occupied=1440-t.empty;
  $('#statsContent').innerHTML=`<div class="stats-top"><div class="stat-day-card"><div class="stat-card-heading"><h2>${dayTitle(day)}</h2><span class="report-badge">${reportLabel}</span></div>${donut(t)}<div class="daily-legend">${legend(t)}</div></div><div class="stat-metrics"><div class="metrics-row">${['study','rest','other'].map(k=>`<div class="metric ${k}"><small>${names[k]}时间</small><strong>${hours(t[k])}<span style="font-size:12px;margin-left:4px">h</span></strong><p>占全天 ${(t[k]/1440*100).toFixed(1)}%</p></div>`).join('')}</div><div class="stat-insight"><h3>${occupied?'每一段投入，都有它的意义。':'空白，是一切可能的开始。'}</h3><p>这一天记录了 <b>${events.length}</b> 段时光，已安排 <b>${duration(occupied)}</b>。<br>${t.empty?`还有 ${duration(t.empty)} 留给未记录的生活。`:'24 小时都有了属于它的颜色。'}</p><div class="allocation-bar">${Object.keys(names).map(k=>`<span class="${k}" style="width:${t[k]/1440*100}%" title="${names[k]} ${duration(t[k])}"></span>`).join('')}</div><p>统计按完整 24 小时计算，相交色块只计算最终保留的部分。<br>记录时长不等同于实际完成时长。</p></div></div></div><div class="week-stats-card"><div class="stat-card-heading"><h2>七天，七种节奏</h2><span class="report-badge">点击圆环切换日期</span></div><div class="week-mini-grid">${Array.from({length:7},(_,i)=>{const d=addDays(first,i),s=totals(d);return `<button class="mini-day ${d===day?'selected':''}" data-day="${d}"><strong>${weekdays[(i+1)%7]}</strong><small>${asDate(d).getMonth()+1}.${asDate(d).getDate()}</small>${donut(s,true)}<span>${d<dateKey()?'已归档':d===dateKey()?'今天':'待到来'}</span></button>`;}).join('')}</div></div><div class="stat-events-card"><div class="stat-card-heading"><h2>这一天的每一笔</h2><button class="text-button" id="statsAdd">${icon('plus')}添加记录</button></div>${events.length?`<table class="stat-table"><thead><tr><th>时间</th><th>事件</th><th>分类</th><th>时长</th><th>备注</th><th></th></tr></thead><tbody>${events.map(e=>`<tr><td>${fmt(e.start)} – ${fmt(e.end)}</td><td>${esc(e.title)}</td><td><span class="category-chip ${e.category}">${names[e.category]}</span></td><td>${duration(e.end-e.start)}</td><td class="note-cell">${esc(e.note)||'—'}${e.images.length?' · '+e.images.length+' 张图片':''}</td><td><button class="link-button edit-stat" data-id="${esc(e.id)}">编辑</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-day"><span class="empty-flower">✳</span>还没有安排。去课表涂上今天的第一笔吧。</div>'}</div>`;
  $$('.mini-day').forEach(b=>b.onclick=()=>{store.selected=b.dataset.day;store.week=monday(store.selected);renderStats();renderWeek();});
  $$('.edit-stat').forEach(b=>b.onclick=()=>openEditor(store.state.events.find(e=>e.id===b.dataset.id)));
  $('#statsAdd').onclick=()=>openEditor({date:store.selected});
}
function init(){
  icons();initEditor();
  $$('.nav-item').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $('.brand').onclick=e=>{e.preventDefault();showView('week');};
  $('#addBtn').onclick=()=>openEditor({date:store.selected});
  $('#prevWeek').onclick=()=>{store.week=addDays(store.week,-7);store.selected=addDays(store.selected,-7);renderWeek();};
  $('#nextWeek').onclick=()=>{store.week=addDays(store.week,7);store.selected=addDays(store.selected,7);renderWeek();};
  $('#todayBtn').onclick=()=>{store.week=monday(dateKey());store.selected=dateKey();renderWeek();if(store.view==='stats')renderStats();else showView('week');};
  $('#dayDetails').onclick=()=>showView('stats');
  $('#statsDate').onchange=()=>{if(!$('#statsDate').value)return;store.selected=$('#statsDate').value;store.week=monday(store.selected);renderStats();renderWeek();};
  $('#templateBtn').onclick=openTemplate;$('#backupBtn').onclick=openBackup;$('#copyBtn').onclick=openCopy;
  $('#undoBtn').onclick=()=>mutate('/api/undo',{}).then(()=>toast('已撤销上一步')).catch(errorToast);
  $('#closeModal').onclick=closeModal;$('#modalOverlay').onclick=e=>{if(e.target.id==='modalOverlay')closeModal();};
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(!$('#modalOverlay').hidden)closeModal();else if(!$('#drawerOverlay').hidden)closeEditor();}
    if(e.key==='Tab'){
      const active=!$('#modalOverlay').hidden?$('.modal'):!$('#drawerOverlay').hidden?$('.drawer'):null;
      if(!active)return;
      const list=[...active.querySelectorAll('button:not(:disabled),input:not([hidden]),textarea,a[href],[tabindex="0"]')].filter(x=>x.getClientRects().length);
      const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&$('#drawerOverlay').hidden&&$('#modalOverlay').hidden&&store.state.canUndo){e.preventDefault();$('#undoBtn').click();}
  });
  document.addEventListener('statechange',()=>{if(!store.state)return;renderWeek();if(store.view==='stats')renderStats();$('#dataLocation').textContent='数据位置：'+store.state.dataPath;});
  reload().catch(e=>{toast(e.message);$('#savedStatus').textContent='连接失败';});
  let lastDay=dateKey();
  setInterval(async()=>{try{await api('/api/health');if(dateKey()!==lastDay){lastDay=dateKey();if($('#drawerOverlay').hidden&&$('#modalOverlay').hidden){await api('/api/reports');await reload();}}$$('.now-line').forEach(el=>el.remove());const col=$(`.day-column[data-day="${dateKey()}"]`);if(col)col.insertAdjacentHTML('beforeend',nowLine(dateKey()));}catch{$('#savedStatus').textContent='连接已断开 · 重新打开应用';}},30000);
  window.addEventListener('focus',()=>{if(store.state&&$('#drawerOverlay').hidden&&$('#modalOverlay').hidden)reload().catch(errorToast);});
}
init();
