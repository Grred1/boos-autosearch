'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../src/core');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function setup(settings={}) {
  const local={settings:C.normalizeConfig(settings)},session={},listeners={},removed=[],created=[];
  let nextId=20, onMessage;
  const store = data => ({
    async get(keys) {if(typeof keys==='string')return {[keys]:structuredClone(data[keys])};return Object.fromEntries(keys.map(k=>[k,structuredClone(data[k])]));},
    async set(values) {Object.assign(data,structuredClone(values));}
  });
  const chrome={
    runtime:{getURL:p=>'chrome-extension://test/'+p,openOptionsPage:async()=>{},onMessage:{addListener:fn=>{onMessage=fn;}}},
    action:{onClicked:{addListener:()=>{}}},permissions:{contains:async()=>true},
    storage:{local:store(local),session:store(session)},
    tabs:{create:async opts=>{const tab={id:nextId++,...opts};created.push(tab);return tab;},remove:async id=>{removed.push(id);},get:async id=>created.find(t=>t.id===id),sendMessage:async()=>{},
      onRemoved:{addListener:fn=>listeners.removed=fn},onUpdated:{addListener:fn=>listeners.updated=fn}}
  };
  const sandbox={chrome,BossCore:C,importScripts:()=>{},setTimeout,clearTimeout,AbortController,crypto:require('node:crypto').webcrypto,Date,URL,fetch:async()=>{throw Error('测试禁止真实网络');}};
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
