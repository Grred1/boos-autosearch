'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../src/core');
const salary = raw => C.salaryCheck(C.parseSalary(raw),25).status;
test('薪资按下限判断，交叉区间保留待确认',()=>{
  assert.equal(salary('25-40K'),'pass'); assert.equal(salary('15-30K'),'review'); assert.equal(salary('15-24K'),'skip');
  assert.equal(salary('25K以上'),'pass'); assert.equal(salary('20K以上'),'review');
});
test('面议、乱码、非法范围及不明单位不默认通过',()=>{
  for (const value of ['', '面议','\ue123-\ue124K','40-25K','25-40','未知']) assert.equal(salary(value),'review',value);
});
test('日薪和年包不伪装成月薪，明确薪数才推算年包',()=>{
  assert.equal(C.parseSalary('200-300元/天').unit,'day'); assert.equal(salary('200-300元/天'),'review');
  assert.equal(C.parseSalary('30-50万/年').annualMin,300);assert.equal(salary('30-50万/年'),'review');
  assert.equal(C.parseSalary('25-40K·16薪').annualMin,400);assert.equal(C.parseSalary('25-40K').annualMin,null);
  assert.equal(C.parseSalary('2.5-4万元/月').min,25);
});
test('链接去除追踪参数并拒绝站外和沟通地址',()=>{
  assert.equal(C.jobURL('https://www.zhipin.com/job_detail/abc-1.html?securityId=secret'),'https://www.zhipin.com/job_detail/abc-1.html');
  for(const url of ['javascript:alert(1)','https://evil.test/job_detail/a.html','https://www.zhipin.com/web/geek/chat','https://www.zhipin.com.evil.test/job_detail/a.html']) assert.equal(C.jobURL(url),null);
});
test('AI英文匹配不误中retail，关键词支持中文与大小写',()=>{
  assert.equal(C.contains('retail manager','AI'),false);assert.equal(C.contains('AI Agent工程师','ai'),true);assert.equal(C.contains('大模型算法','大模型'),true);
});
const job={title:'Agent工程师',city:'上海',salary:'25-40K',jd:'2027届校园招聘，研发智能体和工具调用'};
const config={salaryMin:25,graduationYear:'2027',cities:'上海',direction:'application'};
test('结合校招年份、薪资、城市筛出候选',()=>assert.equal(C.assess(job,config,true).status,'candidate'));
test('年限、排除词、城市不符跳过；年份与方向不明待确认',()=>{
  assert.equal(C.assess({...job,jd:'要求3年以上工作经验'},config,true).status,'skip');
  assert.equal(C.assess({...job,title:'AI销售'},config,true).status,'skip');
  assert.equal(C.assess({...job,city:'北京'},config,true).status,'skip');
  assert.equal(C.assess({...job,jd:'2026届校园招聘'},config,true).status,'review');
  assert.equal(C.assess({...job,jd:'接受应届生'},config,true).status,'review');
  assert.equal(C.assess({...job,title:'AI开发',jd:'2027届校招'},config,true).status,'review');
});
test('数字配置限幅且AI同意必须是显式布尔值',()=>{
  const c=C.normalizeConfig({maxJobs:999,intervalSeconds:0,roundRestMinutes:-2,consent:'true',aiEnabled:'true'});
  assert.equal(c.maxJobs,20);assert.equal(c.intervalSeconds,30);assert.equal(c.roundRestMinutes,5);assert.equal(c.consent,false);assert.equal(c.aiEnabled,false);
});
test('移除手机邮箱，模型格式错误不产生默认话术',()=>{
  const text=C.redact('电话13812345678 邮箱test@example.com');assert.ok(!text.includes('13812345678'));assert.ok(!text.includes('test@example.com'));
  assert.throws(()=>C.validateAnalysis({verdict:'match',greeting:'虚构'}));
  assert.equal(C.validateAnalysis({verdict:'skip',reasons:[],gaps:[],pending:[],greeting:'不应发送'}).greeting,'');
});
test('扩展不加载聊天页、不申请注入权限、不包含原版发送和伪装模块',()=>{
  const m=JSON.parse(fs.readFileSync('manifest.json'));
  assert.deepEqual(m.permissions,['storage']);assert.ok(!JSON.stringify(m.content_scripts).includes('/chat'));
  assert.ok(!JSON.stringify(m).includes('MAIN'));assert.ok(!JSON.stringify(m).includes('anti-detection'));
  for(const name of ['src/modules/automation.js','src/modules/anti-detection.js','src/modules/event-trusted.js']) assert.ok(!fs.existsSync(name));
  const runtime=['background.js','content.js','src/dom.js','options.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
  for(const unsafe of ['/wapi/','isTrusted','executeScript','btn-startchat','btn-send']) assert.ok(!runtime.includes(unsafe),unsafe);
});
