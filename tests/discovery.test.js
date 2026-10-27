/* 隔离执行完整搜索脚本：虚拟列表和虚拟时钟，不访问招聘网站。 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const C=require('../src/core');
async function search(stopDuringRest=false) {
 let clock=1000000,done;const completed=new Promise(resolve=>{done=resolve;});
 class TestDate extends Date {static now(){return clock;}}
 const config=C.normalizeConfig({salaryMin:25,graduationYear:'2027',maxJobs:1,autoContinue:true,reviewOnMatch:true,aiEnabled:true,intervalSeconds:30,roundRestMinutes:5});
 const jobs=[{url:'https://www.zhipin.com/job_detail/intern.html',title:'2027 Agent实习生',salary:'500元/天'},
 {url:'https://www.zhipin.com/job_detail/old.html',title:'Agent校招开发',salary:'30-40K',tags:'在校/应届'},
 {url:'https://www.zhipin.com/job_detail/match.html',title:'Agent校招开发',salary:'30-40K',tags:'在校/应届'}];
 const db={records:{}},calls=[],buttons={};for(const id of ['start','pause','stop','options','status'])buttons[id]={};
 const shadow={getElementById:id=>buttons[id]},host={attachShadow:()=>shadow};
 const document={getElementById:()=>null,createElement:()=>host,body:{appendChild(){}},addEventListener(){}};
 const chrome={storage:{local:{get:async key=>({[key]:structuredClone(db[key])}),set:async values=>Object.assign(db,values)}},runtime:{sendMessage:async msg=>{
   calls.push({...msg,at:clock});
   if(msg.type==='START_RUN')return {ok:true,data:{token:'run',config}};
   if(msg.type==='READ_DETAIL')return {ok:true,data:{jd:msg.url.includes('/old.')?'毕业时间：2025年-2026年\n在校/应届，开发多Agent系统':'毕业时间：2027年\n校招，开发Agent工具调用系统'}};
   if(msg.type==='ANALYZE')return {ok:true,data:{verdict:'match',reasons:['项目匹配'],pending:[],gaps:[],greeting:'您好，我做过Agent工具调用项目，希望进一步沟通。'}};
   if(msg.type==='SAVE_RECORD')db.records[msg.row.url]=structuredClone(msg.row);
   if(msg.type==='REST_RUN'){if(stopDuringRest)queueMicrotask(()=>buttons.stop.onclick());return {ok:true,data:{until:clock+300000}};}
   if(msg.type==='CANCEL_RUN')queueMicrotask(done);
   return {ok:true,data:{}};
 }}};
 const sandbox={chrome,BossCore:C,BossDOM:{risk:()=>'',cards:()=>jobs},document,location:{pathname:'/web/geek/jobs'},window:{scrollBy(){},innerHeight:900},MutationObserver:class{observe(){}},AbortController,Date:TestDate,
 setTimeout:fn=>{clock+=250;queueMicrotask(fn);return 1;},clearTimeout(){},setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(fs.readFileSync('content.js','utf8'),sandbox);
 await buttons.start.onclick();await completed;await new Promise(r=>setImmediate(r));
 return {calls,db,status:buttons.status.textContent};
}
test('脚本独立排除实习、读取并跳过年份不符的JD，休息后继续找到候选',async()=>{
 const r=await search();const reads=r.calls.filter(x=>x.type==='READ_DETAIL');
 assert.equal(reads.length,2);assert.ok(reads[0].url.includes('/old.'));assert.ok(reads[1].url.includes('/match.'));
 assert.ok(reads[1].at-reads[0].at>=300000);assert.equal(r.db.records[reads[0].url].status,'skip');
 assert.equal(r.calls.filter(x=>x.type==='ANALYZE').length,1);assert.equal(r.calls.find(x=>x.type==='PRESENT_REVIEW').url,reads[1].url);
 assert.equal(r.db.records[jobsURL('intern')].status,'skip');assert.match(r.status,/已停在JD等待审核/);
});
const jobsURL=name=>'https://www.zhipin.com/job_detail/'+name+'.html';
test('自动休息期间点击停止，不再启动下一轮或读取下一个JD',async()=>{
 const r=await search(true);assert.equal(r.calls.filter(x=>x.type==='READ_DETAIL').length,1);
 assert.ok(!r.calls.some(x=>x.type==='NEXT_ROUND'));assert.ok(!r.calls.some(x=>x.type==='PRESENT_REVIEW'));
});
