const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function risk({body = '',links = [],blocks = []} = {}) {
  const doc = {body:{innerText:body},querySelectorAll(selector) {
    if (selector === 'a[href]') return links;
    if (selector.startsWith('[role=dialog]')) return blocks;
    return [];
  }};
  const context = {location:{pathname:'/web/geek/jobs'},document:doc,getComputedStyle:()=>({visibility:'visible'})};
  vm.runInNewContext(fs.readFileSync('src/dom.js','utf8'),context);
  return context.BossDOM.risk();
}
const visible = text => ({textContent:text,innerText:text,getClientRects:()=>[{}]});
test('未登录导航链接会阻止开始浏览',()=>assert.match(risk({links:[visible('登录/注册')]}),/尚未登录/));
test('长页面的登录门槛也会被识别，避免读取截断JD',()=>assert.match(risk({body:'职位描述'.repeat(1500)+'登录查看完整内容'}),/完整查看/));
test('普通登录帮助文案和隐藏的登录入口不阻止已登录页面',()=>{
  assert.equal(risk({body:'登录帮助，求职指南，完整职位描述',links:[{...visible('登录/注册'),getClientRects:()=>[]}]}),'');
});
test('安全验证弹窗依然立即停止',()=>assert.match(risk({blocks:[visible('访问过于频繁，请完成验证')]}),/访问限制/));
test('新版单职位容器按链接回退识别，并读取同卡片内公司',()=>{
 const link={href:'https://www.zhipin.com/job_detail/abc.html',textContent:'27届校招Agent工程师',getClientRects:()=>[{}]};
 const values={'.company-name':{textContent:'示例公司'},'.salary':{textContent:'25-35K'},'.job-area':{textContent:'深圳'},'.tag-list':{textContent:'在校/应届'}};
 const item={textContent:'27届校招Agent工程师25-35K示例公司深圳在校/应届',getClientRects:()=>[{}],contains:()=>false,
 querySelector:s=>values[s] || null,querySelectorAll:s=>s==='a[href]'?[link]:[]};
 link.closest=()=>item;
 const doc={querySelectorAll:s=>s==='a[href*="/job_detail/"]'?[link]:[]};
 const context={BossCore:require('../src/core'),document:doc,getComputedStyle:()=>({visibility:'visible'})};
 vm.runInNewContext(fs.readFileSync('src/dom.js','utf8'),context);
 const rows=context.BossDOM.cards();assert.equal(rows.length,1);assert.equal(rows[0].company,'示例公司');assert.equal(rows[0].title,'27届校招Agent工程师');
});
test('详情的全局推荐公司不作为目标公司的回退',()=>{
 const doc={querySelector:s=>s==='.company-name'?{textContent:'推荐企业'}:s==='.job-sec-text'?{textContent:'目标JD'}:null};
 const context={document:doc};vm.runInNewContext(fs.readFileSync('src/dom.js','utf8'),context);
 assert.equal(context.BossDOM.detail().company,'');assert.equal(context.BossDOM.detail().jd,'目标JD');
});
