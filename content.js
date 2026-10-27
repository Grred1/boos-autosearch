/* 搜索页低频浏览，命中后保留JD并停止；发送由独立审核模块处理。 */
(function () {
  'use strict';
  const request = async payload => {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response?.ok) throw new Error(response?.error || '扩展后台未响应，请刷新页面');
    return response.data;
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (location.pathname.startsWith('/job_detail/')) {
    let collecting = false;
    async function collect() {
      if (collecting) return;
      const ready = await request({type:'DETAIL_READY'});
      if (!ready.collect) return;
      collecting = true;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const risk = BossDOM.risk();
        if (risk) { await request({type:'DETAIL_RESULT',error:risk}); return; }
        const data = BossDOM.detail();
        if (data.jd) { await request({type:'DETAIL_RESULT',data}); return; }
        await delay(400);
      }
      await request({type:'DETAIL_RESULT',error:'页面结构异常或JD未加载，停止本轮'});
    }
    chrome.runtime.onMessage.addListener(msg => {
      if (msg.type === 'COLLECT_DETAIL') collect().catch(() => {});
    });
    collect().catch(() => {});
    return;
  }
  if (!location.pathname.startsWith('/web/geek/jobs')) return;
  if (document.getElementById('campus-job-assistant')) return;
  const host = document.createElement('div'); host.id = 'campus-job-assistant';
  const shadow = host.attachShadow({mode:'closed'});
  // 所有职位与模型文本均通过textContent写入，不执行HTML。
  shadow.innerHTML = `<style>
    :host{all:initial}*{box-sizing:border-box}section{position:fixed;right:20px;bottom:24px;width:330px;background:#fff;color:#172d38;border:1px solid #b8cbd1;border-radius:16px;padding:18px;box-shadow:0 8px 32px #17374826;font:14px/1.6 system-ui;z-index:2147483647}h2{font-size:17px;margin:0 0 8px}p{margin:8px 0}button{border:1px solid #abc1c7;border-radius:7px;background:#f3f7f8;padding:7px 10px;cursor:pointer;margin:3px}button:first-of-type{background:#087d72;color:white}button:disabled{opacity:.45;cursor:default}.note{font-size:12px;color:#536a73}#status{white-space:pre-wrap;max-height:130px;overflow:auto}</style>
    <section><h2>秋招职位筛选助手</h2><p class="note">低频浏览，命中后停在JD等待本人审核；只在你逐条确认后执行沟通。低频仍有账号风险。</p><p id="status" role="status" aria-live="polite">先配置条件和简历，再手动开始。</p><button id="start">开始自动找职位</button><button id="pause" disabled>暂停</button><button id="stop" disabled>停止</button><button id="options">配置与候选清单</button><p class="note">脚本自动筛选和浏览；未命中时按配置休息后继续，最多6轮。命中后停在JD等待审核。</p></section>`;
  document.body.appendChild(host);
  const $ = id => shadow.getElementById(id);
  let run = null, starting = false, paused = false;
  let resumePause;
  const status = message => { $('status').textContent = message; };
  function controls() {
    $('start').disabled = !!run || starting;
    $('pause').disabled = !run; $('stop').disabled = !run;
    $('pause').textContent = paused ? '继续' : '暂停';
  }
  async function checkpoint(current) {
    if (run !== current || current.controller.signal.aborted) throw new Error('已停止');
    const risk = BossDOM.risk();
    if (risk) throw new Error(risk);
    if (paused) { await new Promise(resolve => { resumePause = resolve; }); return checkpoint(current); }
  }
  async function wait(ms, current) {
    const deadline=Date.now()+ms;
    while (Date.now()<deadline) {
      await checkpoint(current);
      const step = Math.min(250,Math.max(0,deadline-Date.now()));
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); current.controller.signal.removeEventListener('abort',done); resolve(); };
        const timer = setTimeout(done,step);
        current.controller.signal.addEventListener('abort',done,{once:true});
      });

    }
    await checkpoint(current);
  }
  async function persist(row, current) {
    await request({type:'SAVE_RECORD',token:current.token,row});
  }
  async function finish(current, message) {
    clearInterval(current.heartbeat);
    current.controller.abort();
    paused = false; resumePause?.(); resumePause = null;
    if (run === current) { run = null; controls(); status(message); }
    await request({type:'CANCEL_RUN',token:current.token}).catch(() => {});
    await chrome.storage.local.set({lastRun:{endedAt:new Date().toISOString(),message}}).catch(() => {});
  }
  async function browse(current) {
    const {config:c} = current;
    let totalProcessed=0,totalOpened=0;
    try {
      for(let round=1;round<=6;round++) {
      let processed=0,opened=0,scrolls=0,lastVisit=0,noMore=false;
      while (opened < c.maxJobs && processed < 100) {
        await checkpoint(current);
        const {records = {}} = await chrome.storage.local.get('records');
        await checkpoint(current);
        const visibleJobs=BossDOM.cards();
        const job = BossCore.discoveryOrder(visibleJobs,c).find(j=>!records[j.url]);
        if (!job) {
          if (scrolls >= 2) { noMore=true;status('没有更多未浏览职位，结束搜索'); break; }
          status('当前列表无新职位，等待后向下浏览一次');
          await wait(c.intervalSeconds * 1000,current);
          if(BossDOM.scrollList) BossDOM.scrollList();else window.scrollBy({top:Math.round(window.innerHeight * 0.75),behavior:'smooth'});
          scrolls++;
          await wait(2500,current); continue;
        }
        scrolls = 0;
        processed++;totalProcessed++;
        const row = {...job,...BossCore.assess(job,c),updatedAt:new Date().toISOString(),aiStatus:'未启用',greeting:'',stage:'列表初筛'};
        if (row.status === 'skip') {
          await persist(row,current); status(`第${round}轮，列表已筛${processed}条：跳过 ${job.title}`); continue;
        }
        if (lastVisit) await wait(Math.max(0,c.intervalSeconds * 1000 - (Date.now() - lastVisit)),current);
        await checkpoint(current);
        status(`第${round}轮，读取详情${opened+1}/${c.maxJobs}：${job.title}`);
        lastVisit = Date.now();
        let detail;
        try { detail = await request({type:'READ_DETAIL',token:current.token,url:job.url}); }
        catch (error) {
          if (run === current && !current.controller.signal.aborted) {
            await persist({...row,status:'review',stage:paused ? '暂停时中断' : '读取失败',pending:[...row.pending,error.message]},current);
          }
          if (paused) { await checkpoint(current); continue; }
          throw error;
        }
        await checkpoint(current); opened++;totalOpened++;
        for (const key of ['title','salary','jd']) if (detail[key]) row[key] = detail[key];
        if (!row.company && detail.company) row.company = detail.company;
        if (!row.city && detail.city) row.city = detail.city;
        row.tags = [row.tags,detail.tags].filter(Boolean).join('\n');
        Object.assign(row,BossCore.assess(row,c,true),{stage:'已浏览'});
        const pay=BossCore.salaryCheck(row.salaryInfo,c.salaryMin);
        if (row.status !== 'skip' && pay.status==='pass' && c.aiEnabled) {
          status(`生成匹配分析与话术：${row.title}`);
          try {
            const ai = await request({type:'ANALYZE',token:current.token,job:row});
            await checkpoint(current);
            row.analysis = ai; row.greeting = ai.greeting;row.generatedGreeting=ai.greeting;row.generation=ai.generation;row.draftRevision=0; row.aiStatus = '已生成，请核对';
            row.reasons.push(...ai.reasons); row.pending.push(...ai.pending); row.gaps = ai.gaps;
            if (ai.verdict === 'skip') row.status = 'skip';
            else if (ai.verdict === 'review' || ai.pending.length || ai.gaps.length) row.status = 'review';
          } catch (error) {
            await checkpoint(current);
            row.aiStatus = `失败：${error.message}`; row.status = 'review'; row.greeting = '';
            row.pending.push('模型调用失败，未生成兜底话术');
          }
        } else if (row.status !== 'skip') { row.status = 'review'; row.pending.push(pay.status!=='pass'?'薪资尚未明确达标，保存待确认并继续查找':'尚未进行AI简历匹配，请人工核对'); }
        await checkpoint(current); await persist(row,current);
        if(c.reviewOnMatch && row.status!=='skip' && pay.status==='pass') {
          await request({type:'PRESENT_REVIEW',token:current.token,url:row.url});
          await finish(current,`已停在JD等待审核：${row.title}。确认或暂不沟通后，再手动开始下一轮。`);
          return;
        }
        status(`第${round}轮，列表已筛${processed}条，已读取详情${opened}/${c.maxJobs}：${row.title}`);
      }
      if(!c.autoContinue || round===6 || noMore) break;
      const {until}=await request({type:'REST_RUN',token:current.token});
      status(`第${round}轮未找到明确达标候选，休息至${new Date(until).toLocaleTimeString()}后自动继续。可随时暂停或停止。`);
      await wait(Math.max(0,until-Date.now()),current);
      await request({type:'NEXT_ROUND',token:current.token});
      }
      await finish(current,`搜索结束：列表筛选${totalProcessed}条，读取详情${totalOpened}条。未找到明确达标候选，待确认记录已保存在本机。`);
    } catch (error) {
      if (run === current) await finish(current,`已停止：${error.message}`);
    }
  }
  $('start').onclick = async () => {
    starting = true; controls();
    try {
      const risk = BossDOM.risk(); if (risk) throw new Error(risk);
      if (!BossDOM.cards().length) throw new Error('未识别到职位卡片，请确认搜索页已加载；不会盲目继续浏览');
      const data = await request({type:'START_RUN'});
      run = {...data,controller:new AbortController()}; paused = false;
      const current = run;
      // 内部心跳只维持扩展后台状态，不向BOSS发起请求。
      current.heartbeat = setInterval(() => request({type:'PING',token:current.token}).catch(error => {
        if (run === current) finish(current,`后台状态失效，已停止：${error.message}`);
      }),15000);
      browse(run);
    } catch (error) { status(error.message); }
    finally { starting = false; controls(); }
  };
  // 暂停取消正在读取的详情或模型请求，继续时处理下一条未浏览职位。
  $('pause').onclick = async () => {
    const current = run; if (!current) return;
    $('pause').disabled = true;
    try {
      if (!paused) {
        paused = true;
        await request({type:'PAUSE_RUN',token:current.token});
        status('已暂停。当前请求已取消；已中断的职位保留待确认，继续后浏览下一条。');
      } else {
        await request({type:'RESUME_RUN',token:current.token});
        paused = false; resumePause?.(); resumePause = null;
        status('继续浏览');
      }
      controls();
    } catch (error) { await finish(current,`已停止：${error.message}`); }
  };
  $('stop').onclick = () => { if (run) finish(run,'已停止，已完成记录已保存。'); };
  $('options').onclick = () => request({type:'OPEN_OPTIONS'}).catch(error => status(error.message));
  const observer = new MutationObserver(() => {
    if (!run) return;
    const risk = BossDOM.risk();
    if (risk) finish(run,`已停止：${risk}`);
  });
  observer.observe(document.body,{childList:true,subtree:true});
})();
