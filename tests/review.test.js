'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const R=require('../src/review');
const make=()=>({url:'https://www.zhipin.com/job_detail/a.html',title:'Agent研发',company:'示例公司',jd:'应届生Agent开发',status:'review',greeting:'您好，我参与过工具调用开发，希望进一步沟通。',analysis:{greeting:'模型原稿'},generation:{model:'test',promptVersion:R.PROMPT_VERSION}});
test('多次修改保留模型原稿和每次前后版本，记录不包含简历或Key',()=>{
 const row=make();row.resume='不得进入记录的简历';row.apiKey='不得进入记录的Key';
 const first=R.saveEdit(row,'修改稿1','更简洁');const second=R.saveEdit(row,'修改稿2','增加成果');
 assert.equal(first.generated,'模型原稿');assert.equal(second.generated,'模型原稿');assert.equal(second.before,'修改稿1');assert.equal(second.after,'修改稿2');assert.equal(second.revision,2);
 assert.equal(first.note,'更简洁');assert.ok(!JSON.stringify(second).includes('不得进入记录'));assert.equal(R.saveEdit(row,'修改稿2'),null);
});
test('不改文本也可留下本人确认记录，最终文字严格绑定版本',()=>{
 const row=make(),msg={greeting:row.greeting,revision:0,acknowledged:true,autoGreetingOff:true,recruiter:'陈女士'};
 const result=R.authorize(row,msg,7);assert.equal(result.event.action,'confirm');assert.equal(result.event.changed,false);assert.equal(result.intent.sourceTabId,7);assert.equal(row.communication.text,msg.greeting);
 assert.throws(()=>R.authorize(row,msg,7),/已发起过/);
 const stale=make();R.saveEdit(stale,'新的草稿');assert.throws(()=>R.authorize(stale,msg,7),/话术已变化/);
});
test('空白、过长、未确认、跳过职位或无招聘者均不能授权',()=>{
 const msg={greeting:make().greeting,revision:0,acknowledged:true,autoGreetingOff:true,recruiter:'陈女士'};
 assert.throws(()=>R.authorize(make(),{...msg,acknowledged:false},1),/先确认/);
 assert.throws(()=>R.authorize({...make(),status:'skip'},msg,1),/已跳过/);
 assert.throws(()=>R.authorize(make(),{...msg,recruiter:''},1),/招聘者/);
 assert.throws(()=>R.draft(' '.repeat(3)),/不能为空/);assert.throws(()=>R.draft('a'.repeat(2001)),/2000/);
});
test('相同公司、相似职位或同名招聘者均不足以确认目标',()=>{
 const intent={url:make().url,recruiter:'陈女士'};
 assert.equal(R.identityMatches(intent,{url:intent.url,recruiter:'陈女士'}),true);
 assert.equal(R.identityMatches(intent,{url:'https://www.zhipin.com/job_detail/b.html',recruiter:'陈女士'}),false);
 assert.equal(R.identityMatches(intent,{url:intent.url,recruiter:'王女士'}),false);
});
test('没有本人确认关闭自动招呼时拒绝授权，只生成首次招呼授权',()=>{
 const row=make(),msg={greeting:row.greeting,revision:0,acknowledged:true,recruiter:'陈女士'};
 assert.throws(()=>R.authorize(row,msg,7),/关闭BOSS自动招呼/);
 assert.equal(R.authorize(row,{...msg,autoGreetingOff:true},7).intent.mode,'first-greeting');
});
