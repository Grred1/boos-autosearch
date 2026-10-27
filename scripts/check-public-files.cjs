// 只审计将提交的文件；错误仅输出路径和类别，绝不输出敏感内容。
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const names = cp.execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACMR','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let privateValues = [];
try { privateValues = Object.values(JSON.parse(fs.readFileSync('local/resume.json','utf8')).personal || {}).filter(v=>typeof v==='string' && v.length>=3); } catch { /* 未配置本地简历时仍进行路径及凭据检查 */ }
let failed = false;
for (const name of names) {
  if (name.startsWith('local/') || /\.pdf$/i.test(name) || name === 'resume.json' || /(?:话术修改记录|职位候选)-.*\.json$/.test(name)) {
    console.error('禁止提交个人文件：'+name);failed=true;continue;
  }
  if (/\.(png|jpe?g|gif|ico|webp)$/i.test(name)) continue;
  const text = cp.execFileSync('git',['show',':'+name],{encoding:'utf8',maxBuffer:10*1024*1024});
  if (/sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text)) {
    console.error('疑似凭据：'+name);failed=true;
  }
  if (privateValues.some(value=>text.includes(value))) {console.error('包含本地简历个人信息：'+name);failed=true;}
}
if(failed)process.exit(1);
console.log('公开文件检查通过：'+names.length+'个暂存文件；未输出私人数据。');
