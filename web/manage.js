import {$,store,esc,fmt,dateKey,addDays,monday,api,mutate,toast,errorToast,openModal,closeModal,download} from './shared.js';

export function openTemplate(){
  const text='| 时间 | 安排 |\n| --- | --- |\n'+store.state.slots.map(s=>`| ${fmt(s.start)}–${fmt(s.end)} | ${s.title||''} |`).join('\n');
  openModal('让课表适合你的节奏',`<p>当前模板：${esc(store.state.templateName)} · 每天 ${store.state.slots.length} 段。导入 Markdown，或直接调整下方时间。模板决定虚线底格，现有记录会保留。</p><label class="file-button"><i data-icon="upload"></i>选择 Markdown 文件<input id="mdFile" type="file" accept=".md,.markdown,.txt" hidden></label><textarea id="templateText" rows="13" aria-label="Markdown 时间模板">${esc(text)}</textarea><label class="check-row"><input id="fillWeek" type="checkbox"><span>把「安排」栏的文字也填入当前周的每天<br>有文字的时段将覆盖相交事件；空白栏保持空白。可撤销。</span></label><div id="templatePreview" class="backup-meta">支持 08:00–08:45 / 08:00-08:45。时段不能重叠。</div><div id="modalError" class="form-error"></div><div class="modal-actions"><button id="previewTemplate" class="secondary">检查时段</button><button id="saveTemplate" class="primary">应用时间模板</button></div>`);
  let name=store.state.templateName;
  $('#mdFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>1024*1024){$('#modalError').textContent='Markdown 文件不能超过 1 MB';return;}name=file.name;$('#templateText').value=await file.text();$('#modalError').textContent='';await preview();};
  async function preview(){try{const result=await api('/api/parse',{text:$('#templateText').value});$('#templatePreview').textContent=`识别成功：每天 ${result.slots.length} 段，从 ${fmt(result.slots[0].start)} 到 ${fmt(result.slots.at(-1).end)}。${result.slots.filter(s=>s.title).length} 段含有安排文字。`;$('#modalError').textContent='';}catch(e){$('#modalError').textContent=e.message;}}
  $('#previewTemplate').onclick=preview;
  $('#saveTemplate').onclick=async()=>{const button=$('#saveTemplate');button.disabled=true;try{await mutate('/api/template',{text:$('#templateText').value,name,fillWeek:$('#fillWeek').checked,week:store.week});closeModal();toast('时间模板已更新',true);}catch(e){$('#modalError').textContent=e.message;button.disabled=false;}};
}
export function openBackup(){
  openModal('把时光，好好收藏',`<p>导出一份包含全部事件、时间模板和图片的备份。恢复前会保留当前数据快照，也可以在本次运行中撤销。</p><div class="backup-meta"><b>${store.state.events.length} 段记录 · ${new Set(store.state.events.flatMap(e=>e.images)).size} 张图片</b>本地数据：${esc(store.state.dataPath)}<br>每天首次打开自动备份日程；完整迁移请使用下方导出。</div><div class="modal-actions" style="justify-content:stretch"><button id="exportBackup" class="primary" style="width:100%"><i data-icon="download"></i>导出完整备份</button></div><label class="file-button"><i data-icon="upload"></i>选择备份文件以恢复<input id="restoreFile" type="file" accept=".json" hidden></label><div id="restorePreview" hidden></div><div id="modalError" class="form-error"></div>`);
  $('#exportBackup').onclick=async()=>{const button=$('#exportBackup');button.disabled=true;try{const backup=await api('/api/export');download(`时光涂涂-完整备份-${dateKey()}.json`,JSON.stringify(backup,null,2));toast('备份已导出到下载文件夹');}catch(e){$('#modalError').textContent=e.message;}finally{button.disabled=false;}};
  $('#restoreFile').onchange=async e=>{
    $('#modalError').textContent='';$('#restorePreview').hidden=true;const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>145*1024*1024)throw new Error('备份文件过大，当前支持 145 MB 以内的备份');
      const backup=JSON.parse(await file.text());
      if(backup.version!==1||!Array.isArray(backup.events)||!Array.isArray(backup.slots))throw new Error('这不是有效的时光涂涂备份');
      $('#restorePreview').hidden=false;$('#restorePreview').innerHTML=`<div class="backup-meta"><b>${esc(file.name)}</b>将恢复 ${backup.events.length} 段记录、${Object.keys(backup.media||{}).length} 张图片。<br>这会替换当前全部记录与时间模板。</div><div class="modal-actions"><button id="restoreConfirm" class="primary">确认恢复这份备份</button></div>`;
      $('#restoreConfirm').onclick=async()=>{const button=$('#restoreConfirm');button.disabled=true;try{await mutate('/api/restore',{backup});closeModal();toast('备份恢复完成',true);}catch(e){$('#modalError').textContent=e.message;button.disabled=false;}};
    }catch(e){$('#modalError').textContent=e.message||'无法读取备份文件';}
  };
}
export function openCopy(){
  const count=store.state.events.filter(e=>e.date>=store.week&&e.date<addDays(store.week,7)).length;
  openModal('把这一周的节奏延续下去',`<p>复制 ${store.week} 至 ${addDays(store.week,6)} 的 ${count} 段记录到目标周。文字、分类与图片都会保留；相交时段按新安排覆盖。</p><label class="field-label" for="copyDate">目标周（选择该周任意一天）</label><input type="date" id="copyDate" value="${addDays(store.week,7)}" style="width:100%"><div id="copyHint" class="duration-hint"></div><div id="modalError" class="form-error"></div><div class="modal-actions"><button id="copyConfirm" class="primary" ${count?'':'disabled'}>复制到目标周</button></div>`);
  const update=()=>{$('#copyHint').textContent=$('#copyDate').value?'目标周：'+monday($('#copyDate').value)+' 至 '+addDays(monday($('#copyDate').value),6):'请选择目标周';};update();$('#copyDate').onchange=update;
  $('#copyConfirm').onclick=async()=>{const button=$('#copyConfirm');button.disabled=true;try{if(!$('#copyDate').value)throw new Error('请选择目标周');await mutate('/api/copy-week',{source:store.week,target:monday($('#copyDate').value)});closeModal();toast('这一周的节奏已经复制',true);}catch(e){$('#modalError').textContent=e.message;button.disabled=false;}};
}
