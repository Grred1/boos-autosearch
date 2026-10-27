/* 在隔离DOM替身验证完整发送顺序，绝不访问BOSS或发送真实消息。 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const R=require('../src/review'),C=require('../src/core');
async function run(mode='success') {
 const intent={id:'attempt',url:'https://www.zhipin.com/job_detail/a.html',recruiter:'陈女士',greeting:'您好，我参与过Agent项目，期待进一步沟通。',phase:'opening'};
 const calls=[],nodes=[];let clicked=0,filled=0,read=0,clock=0;
 const input={value:''},send={disabled:false,getAttribute:()=>null,click:()=>{clicked++;input.value='';}},container={};
 const identity={url:intent.url,recruiter:intent.recruiter};
 const chat=()=>{read++;return {input,send,container,identity:mode==='wrong-recipient'?{...identity,recruiter:'王女士'}:mode==='switch-before-click' && read>=3?{...identity,url:'https://www.zhipin.com/job_detail/b.html'}:identity};};
 const document={body:{append:n=>nodes.push(n)},createElement:tag=>({tag,textContent:'',append(){},attachShadow(){return {append(){}};}})};
 const sandbox={location:{pathname:'/web/geek/chat'},document,Date:{now:()=>{clock+=250;return clock;}},setTimeout:fn=>{queueMicrotask(fn);},
  chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{calls.push(msg);return {ok:true,data:msg.type==='GET_SEND_INTENT'?{intent}:{}};}}},
  BossCore:C,BossReview:R,BossDOM:{risk:()=>''},BossChatDOM:{chat,readInput:i=>i.value,fill:(i,text)=>{if(mode==='existing-input')throw Error('输入框已有内容');filled++;i.value=text;},echoes:()=>mode==='already-sent'?1:mode==='no-echo'?0:clicked}};
 vm.runInNewContext(fs.readFileSync('review-content.js','utf8'),sandbox);
 for(let i=0;i<12 && !calls.some(m=>['ui_sent','uncertain'].includes(m.phase));i++)await new Promise(r=>setImmediate(r));
 return {calls,clicked,filled,input};
}
test('已确认话术经身份核对、内容回读、后台提交后只点击一次，回显后才记录成功',async()=>{
 const r=await run();assert.equal(r.clicked,1);assert.equal(r.filled,1);
 assert.deepEqual(r.calls.filter(x=>x.type==='SEND_STEP').map(x=>x.phase),['dispatching','ui_sent']);
});
test('错误聊天对象、已有输入或重复话术均不点击发送',async()=>{
 for(const mode of ['wrong-recipient','existing-input','already-sent']){const r=await run(mode);assert.equal(r.clicked,0,mode);assert.ok(r.calls.some(x=>x.phase==='uncertain'),mode);}
});
test('输入后、点击前切换职位会停止，即使后台已登记一次尝试也不发送',async()=>{
 const r=await run('switch-before-click');assert.equal(r.clicked,0);assert.equal(r.filled,1);assert.equal(r.calls.at(-1).phase,'uncertain');
});
test('点击后无回显只记为结果不明，绝不重试或宣称成功',async()=>{
 const r=await run('no-echo');assert.equal(r.clicked,1);assert.ok(!r.calls.some(x=>x.phase==='ui_sent'));assert.equal(r.calls.at(-1).phase,'uncertain');
});
