'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../src/core');
const R = require('../src/review');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function setup(settings={}) {
  const local={settings:C.normalizeConfig({reviewOnMatch:false,...settings})},session={},listeners={},removed=[],created=[];
  let nextId=20, onMessage;
  const store = data => ({
    async get(keys) {if(typeof keys==='string')return {[keys]:structuredClone(data[keys])};return Object.fromEntries(keys.map(k=>[k,structuredClone(data[k])]));},
    async set(values) {Object.assign(data,structuredClone(values));}
  });
  const chrome={
    runtime:{getURL:p=>'chrome-extension://test/'+p,openOptionsPage:async()=>{},onMessage:{addListener:fn=>{onMessage=fn;}}},
    action:{onClicked:{addListener:()=>{}}},permissions:{contains:async()=>true},
    storage:{local:store(local),session:store(session)},
    tabs:{create:async opts=>{const tab={id:nextId++,...opts};created.push(tab);return tab;},update:async(id,opts)=>Object.assign(created.find(t=>t.id===id),opts),remove:async id=>{removed.push(id);},get:async id=>created.find(t=>t.id===id) || {id},sendMessage:async()=>{},
      onRemoved:{addListener:fn=>listeners.removed=fn},onUpdated:{addListener:fn=>listeners.updated=fn}}
  };
  const sandbox={chrome,BossCore:C,BossReview:R,importScripts:()=>{},setTimeout,clearTimeout,AbortController,crypto:require('node:crypto').webcrypto,Date,URL,fetch:async()=>{throw Error('测试禁止真实网络');}};
  vm.runInNewContext(fs.readFileSync('background.js','utf8'),sandbox);
  const owner={tab:{id:1},url:'https://www.zhipin.com/web/geek/jobs?query=Agent'};
  const send=(msg,sender=owner)=>new Promise(resolve=>onMessage(msg,sender,resolve));
  return {send,local,session,created,removed,listeners,owner,sandbox};
}
test('只有搜索页能开始，停止后不能再打开详情，轮次休息生效',async()=>{
  const h=setup();
  assert.equal((await h.send({type:'START_RUN'},{tab:{id:2},url:'https://evil.test'})).ok,false);
  const {data}=await h.send({type:'START_RUN'});
  assert.equal((await h.send({type:'READ_DETAIL',token:data.token,url:'https://evil.test'})).ok,false);
  assert.equal((await h.send({type:'CANCEL_RUN',token:data.token})).ok,true);
  assert.equal((await h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/a.html'})).ok,false);
  assert.equal((await h.send({type:'START_RUN'})).ok,false);assert.equal(h.created.length,0);
});
test('并发启动只接受一轮',async()=>{
  const h=setup();const answers=await Promise.all([h.send({type:'START_RUN'}),h.send({type:'START_RUN'},{tab:{id:2},url:h.owner.url})]);
  assert.equal(answers.filter(x=>x.ok).length,1);
});
test('已打开详情发生安全跳转即拒绝并关闭，不继续访问',async()=>{
  const h=setup();const {data}=await h.send({type:'START_RUN'});
  const pending=h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/a.html'});
  await tick();assert.equal(h.created.length,1);
  h.listeners.updated(20,{url:'https://www.zhipin.com/web/user/safe/verify'});
  const result=await pending;assert.equal(result.ok,false);assert.match(result.error,/验证或登录/);assert.deepEqual(h.removed,[20]);
  await h.send({type:'CANCEL_RUN',token:data.token});
});
test('暂停关闭详情请求，恢复后仍受访问间隔限制',async()=>{
  const h=setup();const {data}=await h.send({type:'START_RUN'});
  const pending=h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/a.html'});
  await tick();assert.equal((await h.send({type:'PAUSE_RUN',token:data.token})).ok,true);
  assert.equal((await pending).ok,false);assert.deepEqual(h.removed,[20]);
  assert.equal((await h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/b.html'})).ok,false);
  assert.equal((await h.send({type:'RESUME_RUN',token:data.token})).ok,true);
  const limited=await h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/b.html'});
  assert.equal(limited.ok,false);assert.match(limited.error,/下一次访问/);
  await h.send({type:'CANCEL_RUN',token:data.token});
});
test('详情读取只接受本轮创建的标签，完成后关闭并执行数量上限',async()=>{
  const h=setup({maxJobs:1});const {data}=await h.send({type:'START_RUN'});
  assert.equal((await h.send({type:'DETAIL_READY'},{tab:{id:999},url:'https://www.zhipin.com/job_detail/a.html'})).data.collect,false);
  const pending=h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/a.html'});await tick();
  await h.send({type:'DETAIL_RESULT',data:{jd:'2027届校招 Agent研发'}},{tab:{id:20},url:'https://www.zhipin.com/job_detail/a.html'});
  assert.equal((await pending).data.jd,'2027届校招 Agent研发');assert.deepEqual(h.removed,[20]);
  const limit=await h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/b.html'});assert.equal(limit.ok,false);assert.match(limit.error,/上限/);
  await h.send({type:'CANCEL_RUN',token:data.token});
});
test('没有明确同意或未启用模型时绝不发出AI请求',async()=>{
  const h=setup({aiEnabled:true,consent:false,resume:'简历'});const {data}=await h.send({type:'START_RUN'});
  const result=await h.send({type:'ANALYZE',token:data.token,job:{jd:'JD'}});assert.equal(result.ok,false);assert.match(result.error,/明确同意/);
  await h.send({type:'CANCEL_RUN',token:data.token});
});
test('模型请求字段受限并脱敏，不转发Cookie，停止会取消请求',async()=>{
  const h=setup({aiEnabled:true,consent:true,resume:'13812345678 test@example.com Agent项目'});h.local.apiKey='test-key';
  let sent;
  h.sandbox.fetch=async(url,options)=>{sent={url,options};return await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
  const {data}=await h.send({type:'START_RUN'});
  const pending=h.send({type:'ANALYZE',token:data.token,job:{jd:'Agent研发',cookie:'不能发送'}});await tick();
  assert.equal(sent.options.credentials,'omit');assert.ok(!sent.options.body.includes('13812345678'));assert.ok(!sent.options.body.includes('不能发送'));
  await h.send({type:'CANCEL_RUN',token:data.token});assert.equal((await pending).ok,false);assert.equal(sent.options.signal.aborted,true);
});
test('记录串行保存避免覆盖，选项页只能修改话术，运行中不能删除',async()=>{
  const h=setup();const {data}=await h.send({type:'START_RUN'});
  const a='https://www.zhipin.com/job_detail/a.html', b='https://www.zhipin.com/job_detail/b.html';
  await Promise.all([h.send({type:'SAVE_RECORD',token:data.token,row:{url:a,title:'A'}}),h.send({type:'SAVE_RECORD',token:data.token,row:{url:b,title:'B'}})]);
  assert.equal(Object.keys(h.local.records).length,2);
  const options={url:'chrome-extension://test/options.html'};
  assert.equal((await h.send({type:'EDIT_RECORD',url:a,remove:true},options)).ok,false);
  assert.equal((await h.send({type:'EDIT_RECORD',url:a,greeting:'真实草稿'},options)).ok,true);assert.equal(h.local.records[a].greeting,'真实草稿');
  await h.send({type:'CANCEL_RUN',token:data.token});
});

test('有效模型结果解析为分析和草稿，失败不伪造输出',async()=>{
  const h=setup({aiEnabled:true,consent:true,resume:'负责Agent工具调用项目'});h.local.apiKey='test-key';
  h.sandbox.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({verdict:'match',reasons:['项目涉及工具调用'],gaps:[],pending:[],greeting:'您好，我在Agent项目中负责工具调用，期待进一步沟通。'})}}]})});
  const {data}=await h.send({type:'START_RUN'});
  const result=await h.send({type:'ANALYZE',token:data.token,job:{jd:'校招Agent研发'}});
  assert.equal(result.ok,true);assert.equal(result.data.verdict,'match');assert.match(result.data.greeting,/负责工具调用/);
  h.sandbox.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})});
  assert.equal((await h.send({type:'ANALYZE',token:data.token,job:{jd:'校招Agent研发'}})).ok,false);
  await h.send({type:'CANCEL_RUN',token:data.token});
});
test('创建详情标签尚未返回时停止，标签返回后也会关闭',async()=>{
  const h=setup();let release;
  h.sandbox.chrome.tabs.create=()=>new Promise(resolve=>{release=resolve;});
  const {data}=await h.send({type:'START_RUN'});
  const pending=h.send({type:'READ_DETAIL',token:data.token,url:'https://www.zhipin.com/job_detail/a.html'});await tick();
  await h.send({type:'CANCEL_RUN',token:data.token});release({id:77});
  assert.equal((await pending).ok,false);assert.deepEqual(h.removed,[77]);
});
test('本人关闭简历脱敏后原文进入所选模型请求，Key不进入正文或搜索页配置',async()=>{
 const h=setup({aiEnabled:true,consent:true,redactResume:false,resume:'示例候选人 13800000000 demo@example.invalid，参与工具调用项目'});h.local.apiKey='dummy-key';
 let payload;
 h.sandbox.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({verdict:'review',reasons:[],gaps:[],pending:['需核对资格'],greeting:'您好，我参与过工具调用项目，期待了解岗位。'})}}]})};};
 const {data}=await h.send({type:'START_RUN'});assert.equal(data.config.resume,undefined);
 const result=await h.send({type:'ANALYZE',token:data.token,job:{jd:'校招Agent开发'}});
 assert.equal(result.ok,true);assert.match(payload.messages[1].content,/13800000000/);assert.match(payload.messages[1].content,/demo@example.invalid/);assert.ok(!JSON.stringify(payload).includes('dummy-key'));
 await h.send({type:'CANCEL_RUN',token:data.token});
});
test('缓存JD重新分析无需访问BOSS，应用新条件与公司修正且保留冷却',async()=>{
 const h=setup({aiEnabled:true,consent:true,redactResume:false,resume:'某大学2027届硕士，完成Agent项目和工具调用',salaryMin:25,graduationYear:'2027'});
 h.local.apiKey='dummy-key';h.local.cooldownUntil=Date.now()+300000;
 const until=h.local.cooldownUntil,url='https://www.zhipin.com/job_detail/a.html';
 h.local.records={[url]:{url,title:'27届校招Agent工程师',salary:'20-35K',jd:'参与Agent工具调用和多智能体系统开发',company:'错误公司'}};
 let payload;
 h.sandbox.fetch=async(u,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({verdict:'match',reasons:['项目匹配'],gaps:[],pending:[],greeting:'您好，我参与过Agent工具调用系统开发，希望进一步沟通。'})}}]})};};
 const r=await h.send({type:'REANALYZE_RECORD',url,company:'待核实企业'},{tab:{id:99},url:'chrome-extension://test/options.html'});
 assert.equal(r.ok,true);assert.equal(h.created.length,0);assert.equal(h.local.cooldownUntil,until);
 assert.equal(h.local.records[url].company,'待核实企业');assert.equal(h.local.records[url].status,'review');
 assert.match(payload.messages[1].content,/待核实企业/);assert.match(h.local.records[url].greeting,/您好，我/);
 assert.equal(h.local.records[url].analysis.verdict,'match');
});

const jobURL='https://www.zhipin.com/job_detail/review.html';
const detailSender={tab:{id:8},url:jobURL};
function reviewSetup(){const h=setup();h.local.records={[jobURL]:{url:jobURL,title:'Agent工程师',company:'示例公司',salary:'25-35K',jd:'2027届校招',status:'candidate',greeting:'您好，我参与过Agent工具调用开发，希望进一步沟通。',generation:{promptVersion:R.PROMPT_VERSION,model:'test'}}};return h;}
async function approve(h){const row=h.local.records[jobURL];return h.send({type:'AUTHORIZE_SEND',greeting:row.greeting,revision:row.draftRevision || 0,acknowledged:true,recruiter:'陈女士'},detailSender);}
test('审核模式复用原JD标签，不重复访问，展示后停止浏览并阻止下一轮',async()=>{
 const h=setup({reviewOnMatch:true});const {data}=await h.send({type:'START_RUN'});
 const read=h.send({type:'READ_DETAIL',token:data.token,url:jobURL});await tick();
 await h.send({type:'DETAIL_RESULT',data:{jd:'2027届Agent开发'}},{tab:{id:20},url:jobURL});assert.equal((await read).ok,true);assert.deepEqual(h.removed,[]);
 await h.send({type:'SAVE_RECORD',token:data.token,row:{url:jobURL,jd:'2027届Agent开发',status:'review',greeting:'原稿'}});
 assert.equal((await h.send({type:'PRESENT_REVIEW',token:data.token,url:jobURL})).ok,true);assert.equal(h.created.length,1);assert.equal(h.created[0].active,true);assert.deepEqual(h.removed,[]);
 assert.equal(h.local.activeReviewURL,jobURL);assert.equal((await h.send({type:'PING',token:data.token})).ok,false);
 h.local.cooldownUntil=0;assert.match((await h.send({type:'START_RUN'})).error,/等待审核/);
 assert.equal((await h.send({type:'SKIP_REVIEW'},{tab:{id:20},url:jobURL})).ok,true);assert.equal(h.local.activeReviewURL,null);
 const again=await h.send({type:'START_RUN'});assert.equal(again.ok,true);await h.send({type:'CANCEL_RUN',token:again.data.token});
});
test('发送授权只给当前JD，陈旧话术及未确认拒绝，确认同时留下本地记录',async()=>{
 const h=reviewSetup();const row=h.local.records[jobURL];
 assert.equal((await h.send({type:'AUTHORIZE_SEND',greeting:row.greeting,revision:0,acknowledged:true,recruiter:'陈女士'})).ok,false);
 assert.equal((await h.send({type:'AUTHORIZE_SEND',greeting:row.greeting,revision:0,acknowledged:false,recruiter:'陈女士'},detailSender)).ok,false);
 assert.equal((await h.send({type:'AUTHORIZE_SEND',greeting:'其他文本',revision:0,acknowledged:true,recruiter:'陈女士'},detailSender)).ok,false);
 const r=await approve(h);assert.equal(r.ok,true);assert.equal(h.local.feedback.length,1);assert.equal(h.local.feedback[0].action,'confirm');
 assert.equal((await approve(h)).ok,false);
 assert.equal((await h.send({type:'EDIT_RECORD',url:jobURL,greeting:'偷偷改稿'},{url:'chrome-extension://test/options.html'})).ok,false);
});
test('只对绑定会话授权一次发送，错误对象、新标签和重复点击均拒绝',async()=>{
 const h=reviewSetup(),{data}=await approve(h),id=data.intent.id;
 const step=(phase,sender=detailSender,identity={url:jobURL,recruiter:'陈女士'})=>h.send({type:'SEND_STEP',id,phase,identity},sender);
 assert.equal((await step('ui_sent')).ok,false);assert.equal((await step('opening')).ok,true);assert.equal((await step('opening')).ok,false);
 const unrelated={tab:{id:77},url:'https://www.zhipin.com/web/geek/chat'};
 assert.equal((await h.send({type:'GET_SEND_INTENT'},unrelated)).data.intent,undefined);assert.equal((await step('dispatching',unrelated)).ok,false);
 const chatSender={tab:{id:8},url:'https://www.zhipin.com/web/geek/chat'};
 assert.equal((await step('dispatching',chatSender,{url:jobURL,recruiter:'王女士'})).ok,false);
 assert.equal((await step('dispatching',chatSender)).ok,true);assert.equal((await step('dispatching',chatSender)).ok,false);
 assert.equal((await step('ui_sent',chatSender)).ok,true);assert.equal(h.local.records[jobURL].communication.state,'ui_sent');assert.equal(h.session.sendIntent,null);
 assert.equal((await step('dispatching',chatSender)).ok,false);assert.equal((await approve(h)).ok,false);
});
test('超时或不确定结果不会重放授权，刷新聊天页不恢复已提交的发送',async()=>{
 const h=reviewSetup(),{data}=await approve(h),id=data.intent.id;
 await h.send({type:'SEND_STEP',id,phase:'opening'},detailSender);
 await h.send({type:'SEND_STEP',id,phase:'dispatching',identity:{url:jobURL,recruiter:'陈女士'}},detailSender);
 assert.equal((await h.send({type:'GET_SEND_INTENT'},detailSender)).data.intent,undefined);
 assert.equal((await h.send({type:'SEND_STEP',id,phase:'uncertain',error:'页面没有回显'},detailSender)).ok,true);
 assert.equal(h.local.records[jobURL].communication.state,'uncertain');assert.equal((await approve(h)).ok,false);
});
test('从当前JD打开的新聊天标签可承接授权，但授权过期后不能点击发送',async()=>{
 const h=reviewSetup(),{data}=await approve(h),id=data.intent.id;
 h.created.push({id:70,openerTabId:8,url:'https://www.zhipin.com/web/geek/chat'});
 const child={tab:{id:70},url:'https://www.zhipin.com/web/geek/chat'};
 assert.equal((await h.send({type:'GET_SEND_INTENT'},child)).data.intent.id,id);
 await h.send({type:'SEND_STEP',id,phase:'opening'},detailSender);
 h.session.sendIntent.expiresAt=Date.now()-1;
 assert.equal((await h.send({type:'SEND_STEP',id,phase:'dispatching',identity:{url:jobURL,recruiter:'陈女士'}},child)).ok,false);
});
test('人工核对不确定结果可结束本条审核，但不会解除重复发送锁',async()=>{
 const h=reviewSetup();h.local.activeReviewURL=jobURL;const {data}=await approve(h);
 await h.send({type:'SEND_STEP',id:data.intent.id,phase:'uncertain',error:'未确认回显'},detailSender);
 assert.equal((await h.send({type:'ACK_SEND_RESULT'},detailSender)).ok,true);assert.equal(h.local.activeReviewURL,null);
 assert.ok(h.local.records[jobURL].communication.manualCheckedAt);assert.equal((await approve(h)).ok,false);
 const next=await h.send({type:'START_RUN'});assert.equal(next.ok,true);await h.send({type:'CANCEL_RUN',token:next.data.token});
});
