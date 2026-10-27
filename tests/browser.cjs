/* 离线浏览器集成检查：新建独立Chrome上下文，所有页面都由本地fixture拦截提供。 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL || 'chrome'});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body></body></html>'}));
  const page = await context.newPage();
  const sample={url:'https://www.zhipin.com/job_detail/sample.html',title:'Agent应用开发 <img src=x onerror=alert(1)>',company:'示例公司',city:'上海',salary:'25–40K·16薪',status:'review',stage:'已浏览',direction:'Agent／大模型应用',eligibility:'2027届校招',aiStatus:'已生成，请核对',reasons:['具备工具调用项目经验'],pending:['核对业务方向'],gaps:['评测经验需补充'],greeting:'您好，我在知识库项目中负责RAG检索和工具调用，期待了解岗位。',jd:'2027届校招，负责Agent工具调用与RAG系统。',updatedAt:new Date().toISOString()};
  await page.goto('https://fixture.test/options');
  await page.setContent(fs.readFileSync('options.html','utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,''));
  await page.addStyleTag({path:'options.css'});
  await page.evaluate(({sample})=>{
    const db={settings:{graduationYear:'2027',salaryMin:25},records:{[sample.url]:sample}};
    window.__db=db;
    window.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(db[k])]))}},permissions:{request:async()=>true},runtime:{sendMessage:async msg=>{
      if(msg.type==='SAVE_SETTINGS'){db.settings=msg.settings;db.apiKey=msg.apiKey;return {ok:true};}
      if(msg.type==='EDIT_RECORD'){if(msg.remove)delete db.records[msg.url];else db.records[msg.url].greeting=msg.greeting;return {ok:true};}
    }}};
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}});
  },{sample});
  await page.addScriptTag({path:'src/core.js'});await page.addScriptTag({path:'src/resume.js'});await page.addScriptTag({path:'src/review.js'});await page.addScriptTag({path:'options.js'});
  await page.getByRole('heading',{name:sample.title}).waitFor();
  assert.equal(await page.locator('.job img').count(),0);
  await page.locator('.job h3 a').evaluate(el=>{el.textContent='Agent应用开发工程师';});
  await page.getByRole('textbox',{name:sample.title+'的话术草稿'}).fill('仅包含真实经历的新草稿');
  await page.getByRole('button',{name:'保存话术',exact:true}).click();await page.getByText('话术已保存；修改记录仅保存在本机',{exact:true}).waitFor();
  assert.equal(await page.evaluate(url=>window.__db.records[url].greeting,sample.url),'仅包含真实经历的新草稿');
  await page.getByRole('button',{name:'复制话术',exact:true}).click();await page.getByText('已复制，请核对后手动发送').waitFor();
  assert.equal(await page.evaluate(()=>window.__copied),'仅包含真实经历的新草稿');
  await page.getByRole('button',{name:'保存配置并授权模型域名'}).click();await page.getByText('配置已保存，回到BOSS搜索页点击开始。').waitFor();
  fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/options-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/options-mobile.png',fullPage:true});
  console.log('PASS 配置保存、候选呈现、HTML转义、话术编辑保存复制及桌面/窄屏布局');
  const jobs=await context.newPage();await jobs.goto('https://www.zhipin.com/web/geek/jobs?query=Agent');
  await jobs.setContent('<!doctype html><html><body><div class="job-card-wrapper"><a href="/job_detail/a.html"><span class="job-name">Agent工程师</span></a><span class="company-name">公司A</span><span class="salary">25-40K</span><span class="job-area">上海</span><div class="tag-list">2027届校招</div></div><div class="job-card-wrapper"><a href="/job_detail/b.html"><span class="job-name">大模型工程师</span></a><span class="salary">30-45K</span><span class="job-area">上海</span><div class="tag-list">2027届校招</div></div></body></html>');
  await jobs.clock.install();
  await jobs.evaluate(()=>{
    // 仅测试fixture开放ShadowRoot，便于验证用户按钮；正式代码保持closed。
    const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(opts){return attach.call(this,{...opts,mode:'open'});};
    const db={records:{}};window.__db=db;window.__calls=[];let detailReject;
    window.chrome={storage:{local:{get:async key=>({[key]:structuredClone(db[key])}),set:async values=>Object.assign(db,values)}},runtime:{sendMessage:async msg=>{
      window.__calls.push(msg.type);
      if(msg.type==='START_RUN')return {ok:true,data:{token:'test',config:BossCore.normalizeConfig({maxJobs:2,graduationYear:'2027',salaryMin:25,intervalSeconds:30,reviewOnMatch:false,autoContinue:false})}};
      if(msg.type==='READ_DETAIL')return new Promise((resolve,reject)=>{detailReject=reject;window.__finishDetail=()=>resolve({ok:true,data:{jd:'2027届校招，开发Agent工具调用'}});});
      if(msg.type==='SAVE_RECORD'){db.records[msg.row.url]=msg.row;return {ok:true};}
      if(msg.type==='PAUSE_RUN'||msg.type==='CANCEL_RUN'){if(detailReject){detailReject(new Error(msg.type==='PAUSE_RUN'?'已暂停':'已停止'));detailReject=null;}return {ok:true};}
      return {ok:true};
    }}};
  });
  await jobs.addScriptTag({path:'src/core.js'});await jobs.addScriptTag({path:'src/dom.js'});await jobs.addScriptTag({path:'content.js'});
  await jobs.getByRole('button',{name:'开始自动找职位'}).click();
  await jobs.waitForFunction(()=>window.__calls.includes('READ_DETAIL'));
  await jobs.getByRole('button',{name:'暂停',exact:true}).click();await jobs.getByText(/已暂停。当前请求已取消/).waitFor();
  assert.equal(await jobs.evaluate(()=>window.__calls.filter(x=>x==='READ_DETAIL').length),1);
  await jobs.getByRole('button',{name:'继续',exact:true}).click();
  await jobs.clock.runFor(31000);
  await jobs.waitForFunction(()=>window.__calls.filter(x=>x==='READ_DETAIL').length===2);
  await jobs.getByRole('button',{name:'停止',exact:true}).click();
  await jobs.clock.fastForward(120000);
  assert.equal(await jobs.evaluate(()=>window.__calls.filter(x=>x==='READ_DETAIL').length),2);
  assert.ok(await jobs.evaluate(()=>Object.values(window.__db.records).some(r=>r.stage==='暂停时中断')));
  console.log('PASS 真实按钮触发浏览、暂停取消、继续遵守间隔、停止后不再访问');
  // 运行中出现安全提示，MutationObserver立即停止。
  await jobs.getByRole('button',{name:'开始自动找职位'}).click();
  await jobs.waitForFunction(()=>window.__calls.filter(x=>x==='READ_DETAIL').length===3);
  await jobs.evaluate(()=>{const d=document.createElement('div');d.className='dialog';d.textContent='访问过于频繁，请完成验证';document.body.append(d);});
  await jobs.getByText(/已停止：检测到访问限制/).waitFor();
  assert.equal(await jobs.getByRole('button',{name:'停止',exact:true}).isDisabled(),true);
  console.log('PASS 运行中验证提示触发立即停止');
  assert.deepEqual(errors,[]);
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
