'use strict';
const form = document.getElementById('settings');
const $ = id => document.getElementById(id);
let config = {...BossCore.defaults};
const numberFields = ['salaryMin','maxJobs','intervalSeconds','roundRestMinutes'];
const boolFields = ['aiEnabled','consent'];
const labels = {candidate:'候选',review:'待确认',skip:'已跳过'};
const providerOrigins = {deepseek:'https://api.deepseek.com/*',openai:'https://api.openai.com/*'};
function say(message, error = false) { $('save-status').textContent = message; $('save-status').className = error ? 'error':'success'; }
async function load() {
  const stored = await chrome.storage.local.get(['settings','apiKey']);
  config = BossCore.normalizeConfig(stored.settings);
  for (const key of Object.keys(BossCore.defaults)) {
    const field = form.elements.namedItem(key);
    if (boolFields.includes(key)) field.checked = config[key]; else field.value = config[key];
  }
  $('api-key').value = stored.apiKey || '';
  await render();
}
form.elements.provider.onchange = () => {
  form.elements.model.value = form.elements.provider.value === 'deepseek' ? 'deepseek-chat' : '';
  form.elements.consent.checked = false;
};
form.onsubmit = async event => {
  event.preventDefault();
  try {
    const raw = {};
    for (const key of Object.keys(BossCore.defaults)) {
      const field = form.elements.namedItem(key);
      raw[key] = boolFields.includes(key) ? field.checked : numberFields.includes(key) ? Number(field.value) : field.value.trim();
    }
    if (raw.aiEnabled && (!raw.consent || !raw.resume || !$('api-key').value.trim())) throw new Error('启用AI需填写简历、API Key并勾选数据发送同意');
    if (raw.aiEnabled) {
      const granted = await chrome.permissions.request({origins:[providerOrigins[raw.provider]]});
      if (!granted) throw new Error('未授权模型域名，配置未保存');
    }
    const response = await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:raw,apiKey:$('api-key').value});
    if (!response?.ok) throw new Error(response?.error || '保存失败');
    config = BossCore.normalizeConfig(raw);
    say('配置已保存，回到BOSS搜索页点击开始。');
  } catch (error) { say(error.message,true); }
};
const element = (tag, text, className) => {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;
};
function list(parent, title, items) {
  if (!items?.length) return;
  parent.append(element('strong',title));
  const ul = element('ul'); for (const item of items) ul.append(element('li',item)); parent.append(ul);
}
async function updateRecord(url, fields) {
  const response = await chrome.runtime.sendMessage({type:'EDIT_RECORD',url,...fields});
  if (!response?.ok) throw new Error(response?.error || '保存失败');
}
async function render() {
  const {records = {},cooldownUntil = 0,lastRun} = await chrome.storage.local.get(['records','cooldownUntil','lastRun']);
  const rows = Object.values(records).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('summary').textContent = `${rows.length}条 · 候选${rows.filter(x=>x.status==='candidate').length} · 待确认${rows.filter(x=>x.status==='review').length}${cooldownUntil > Date.now() ? ' · 休息至'+new Date(cooldownUntil).toLocaleTimeString():''}${lastRun ? ' · '+lastRun.message : ''}`;
  const target = $('records'); target.replaceChildren();
  for (const row of rows.filter(x => $('filter').value === 'all' || x.status === $('filter').value)) {
    const card = element('article',undefined,'job');
    card.append(element('span',labels[row.status] || '已浏览',`badge ${row.status}`));
    const heading = element('h3'), link = element('a',row.title || '未命名岗位');
    const safeURL = BossCore.jobURL(row.url); if (safeURL) { link.href = safeURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    heading.append(link);card.append(heading);
    card.append(element('p',[row.company,row.city,row.salary || '薪资待确认'].filter(Boolean).join(' · '),'meta'));
    card.append(element('p',`${row.direction || '方向待确认'} · ${row.stage || '已浏览'} · ${row.aiStatus || '未分析'}`,'meta'));
    if (row.salaryInfo?.annualMin) card.append(element('p',`标注年薪或按明确薪数计算：${row.salaryInfo.annualMin}K起（未标薪数时不推算）`,'meta'));
    if (row.eligibility) card.append(element('p',`秋招资格：${row.eligibility}`,'meta'));
    list(card,'筛选与匹配理由',row.reasons);list(card,'待确认',row.pending);list(card,'技能／经历缺口',row.gaps);
    if (row.jd) { const details = element('details');details.append(element('summary','查看JD'),element('pre',row.jd));card.append(details); }
    const draft = element('textarea');draft.value = row.greeting || ''; draft.placeholder = '暂无话术；可手动补充。'; draft.setAttribute('aria-label',`${row.title}的话术草稿`);card.append(draft);
    const note = element('p','','hint');
    const save = element('button','保存话术');save.onclick = async () => {
      try { await updateRecord(row.url,{greeting:draft.value});note.textContent='话术已保存'; } catch(e) { note.textContent=e.message; }
    };
    const copy = element('button','复制话术');copy.onclick = async () => {
      try { await navigator.clipboard.writeText(draft.value);note.textContent='已复制，请核对后手动发送'; } catch { note.textContent='复制失败，请选中文本手动复制'; }
    };
    const remove = element('button','移出记录');remove.onclick = async () => {
      if (!confirm('移出后，下次浏览可能再次处理该职位。确定移出？')) return;
      try { await updateRecord(row.url,{remove:true});await render(); } catch(e) { note.textContent=e.message; }
    };
    card.append(save,copy,remove,note);target.append(card);
  }
  if (!target.children.length) target.append(element('p','暂无记录。请在BOSS搜索页配置好官方搜索条件，再开始一轮浏览。','hint'));
}
$('refresh').onclick = () => render().catch(e=>say(e.message,true));
$('filter').onchange = () => render().catch(e=>say(e.message,true));
$('export').onclick = async () => {
  const {records = {}} = await chrome.storage.local.get('records');
  const url = URL.createObjectURL(new Blob([JSON.stringify(Object.values(records),null,2)],{type:'application/json'}));
  const a = element('a');a.href=url;a.download=`职位候选-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
load().catch(e=>say(e.message,true));
