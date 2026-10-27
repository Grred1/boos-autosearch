/* 只在JD上展示审核。可信的本人按钮点击是发送授权的唯一入口。 */
(function () {
  'use strict';
  const detail=location.pathname.startsWith('/job_detail/');
  if (!detail && !location.pathname.startsWith('/web/geek/chat')) return;
  const request=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error || '后台失效，请刷新');return r.data;};
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let running=false,stopped=false,panel;
  const risk=()=>{if(stopped)throw Error('已手动停止');const warning=BossDOM.risk();if(warning)throw Error(warning);};
  async function sendChat(intent,report) {
    if (running) return;
    running=true;
    try {
      const deadline=Date.now()+20000;
      let c,continued=false;
      while(Date.now()<deadline) {
        risk();c=BossChatDOM.chat();
        if(c?.identity.url && c.identity.recruiter) break;
        if(detail && !continued) {
          const next=BossChatDOM.continuation();
          if(next) {continued=true;next.click();} // 完整导航由新脚本接手；SPA继续在本页面核对身份。
        }
        await delay(400);
      }
      if (!c || !BossReview.identityMatches(intent,c.identity)) throw Error('无法从当前聊天顶部核实原职位链接和招聘者，已停止，请手动核对');
      const before=BossChatDOM.echoes(c.container,intent.greeting);
      if(before) throw Error('会话已有相同话术，已停止以免重复发送');
      BossChatDOM.fill(c.input,intent.greeting);
      await delay(350);risk();
      c=BossChatDOM.chat();
      if(!c || !BossReview.identityMatches(intent,c.identity) || BossChatDOM.readInput(c.input)!==intent.greeting || !c.send || c.send.disabled || c.send.getAttribute('aria-disabled')==='true') throw Error('会话、输入内容或发送按钮不可用，请人工核对');
      // 先持久化不可重试状态，再进行唯一一次点击。网络不确定时不会重发。
      await request({type:'SEND_STEP',id:intent.id,phase:'dispatching',identity:c.identity});
      risk();
      const current=BossChatDOM.chat();
      if(!current || !BossReview.identityMatches(intent,current.identity) || BossChatDOM.readInput(current.input)!==intent.greeting || current.send!==c.send) throw Error('发送前页面发生变化，已停止');
      c.send.click();
      const end=Date.now()+10000;
      while(Date.now()<end) {
        await delay(400);risk();const after=BossChatDOM.chat();
        if(!after || !BossReview.identityMatches(intent,after.identity)) throw Error('发送后会话发生变化，请自行核对');
        if(!BossChatDOM.readInput(after.input).trim() && BossChatDOM.echoes(after.container,intent.greeting)>before) {
          await request({type:'SEND_STEP',id:intent.id,phase:'ui_sent',identity:after.identity});
          report('页面已出现本条话术，发送操作完成；送达状态请以BOSS为准。');return;
        }
      }
      throw Error('未观察到明确发送结果，请到BOSS核对；不会自动重试');
    } catch(error) {
      await request({type:'SEND_STEP',id:intent.id,phase:'uncertain',error:error.message}).catch(()=>{});
      report(error.message);
    } finally {running=false;}
  }
  function shell(title) {
    const host=el('div');host.id='campus-job-review';const shadow=host.attachShadow({mode:'closed'});
    const style=el('style',':host{all:initial}*{box-sizing:border-box}aside{position:fixed;right:16px;top:90px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 110px);overflow:auto;background:white;color:#18343b;border:1px solid #abc8c2;border-radius:14px;padding:18px;box-shadow:0 8px 32px #17374826;z-index:2147483647;font:14px/1.6 system-ui}h2{margin:0;font-size:18px}p{white-space:pre-wrap;margin:8px 0}textarea{width:100%;min-height:150px;font:14px/1.6 system-ui;padding:10px;border:1px solid #b8cbc7;border-radius:8px}textarea.reason{min-height:60px}button{font:inherit;margin:6px 6px 0 0;padding:7px 10px;border:1px solid #b8cbc7;border-radius:6px;background:#f3f8f6;cursor:pointer}button.primary{background:#087c70;color:#fff}button:disabled{opacity:.5;cursor:default}.note{font-size:12px;color:#536a73}.warning{background:#fff3db;padding:8px}label{display:block;margin:8px 0}');
    const box=el('aside');box.append(el('h2',title));shadow.append(style,box);document.body.append(host);return {host,box};
  }
  async function showReview() {
    if(!detail || running) return;
    const {row,feedbackCount}=await request({type:'GET_REVIEW'});
    if(!row?.jd) return;
    panel?.host.remove();panel=shell('职位与话术审核');const {box}=panel;
    box.append(el('p',row.title),el('p',[row.company,row.city,row.salary].filter(Boolean).join(' · ')));
    const status=el('p',row.status==='candidate'?'筛选条件通过，仍请核对JD。':row.status==='skip'?'已筛选跳过，不支持发送。':'待确认：'+(row.pending || []).join('；'));status.className='warning';box.append(status);
    if(row.gaps?.length) box.append(el('p','经历缺口：'+row.gaps.join('；')));
    const draft=el('textarea');draft.value=row.greeting || '';draft.maxLength=2000;draft.setAttribute('aria-label','审核并修改话术');
    const reason=el('textarea');reason.className='reason';reason.maxLength=1000;reason.placeholder='修改原因（选填，例如更简洁、突出项目成果）';reason.setAttribute('aria-label','话术修改原因');
    box.append(el('p','最终发送话术'),draft,reason);
    const note=el('p',`修改记录仅存本机，已有 ${feedbackCount} 条；不会自动用作模型训练。`);note.className='note';box.append(note);
    const acknowledge=el('label');const check=el('input');check.type='checkbox';
    acknowledge.append(check,document.createTextNode(' 我已核对当前职位和话术，允许点击立即沟通；了解BOSS可能先发默认招呼并展示在线简历，再发送下方话术。'));box.append(acknowledge);
    const message=el('p');message.setAttribute('role','status');
    const save=el('button','保存修改');const send=el('button','确认本职位并沟通发送');send.className='primary';send.disabled=true;
    const skip=el('button','本条暂不沟通');
    let revision=row.draftRevision || 0;
    const locked=!!row.communication || row.status==='skip';
    draft.disabled=reason.disabled=save.disabled=check.disabled=skip.disabled=locked;
    const invalidate=()=>{check.checked=false;send.disabled=true;};draft.oninput=reason.oninput=invalidate;
    check.onchange=()=>{send.disabled=!check.checked || locked || !draft.value.trim();};
    save.onclick=async event=>{
      if(!event.isTrusted)return;save.disabled=true;
      try {await request({type:'EDIT_RECORD',url:row.url,greeting:draft.value,note:reason.value,revision});const r=await request({type:'GET_REVIEW'});revision=r.row.draftRevision || 0;message.textContent='话术已保存；有文字修改时会记录前后版本与原因（仅本机）。';invalidate();}
      catch(error){message.textContent=error.message;}finally{save.disabled=locked;}
    };
    skip.onclick=async event=>{if(!event.isTrusted)return;try{await request({type:'EDIT_RECORD',greeting:draft.value,note:reason.value,revision});await request({type:'SKIP_REVIEW',note:reason.value});box.replaceChildren(el('h2','本条暂不沟通'),el('p','已保存本地记录。回到搜索页，休息结束后可手动开始下一轮。'));}catch(error){message.textContent=error.message;}};
    send.onclick=async event=>{
      if(!event.isTrusted || !check.checked || running)return;
      send.disabled=save.disabled=skip.disabled=draft.disabled=reason.disabled=check.disabled=true;
      let intent;
      try {
        risk();const entry=BossChatDOM.entry(),recruiter=BossChatDOM.recruiter();
        if(!entry || !recruiter)throw Error('未唯一识别到当前职位的沟通入口和招聘者，请手动核对');
        await request({type:'EDIT_RECORD',greeting:draft.value,note:reason.value,revision});
        const fresh=await request({type:'GET_REVIEW'});revision=fresh.row.draftRevision || 0;
        ({intent}=await request({type:'AUTHORIZE_SEND',greeting:draft.value,note:reason.value,revision,acknowledged:true,recruiter}));
        await request({type:'SEND_STEP',id:intent.id,phase:'opening'});risk();
        if(BossCore.jobURL(location.href)!==row.url || BossChatDOM.entry()!==entry || BossChatDOM.recruiter()!==recruiter)throw Error('沟通前职位或招聘者变化，已停止');
        message.textContent='正在打开本职位沟通，随后核对会话并发送一次…';
        entry.click();await sendChat(intent,text=>{message.textContent=text;});
      } catch(error) {
        if(intent)await request({type:'SEND_STEP',id:intent.id,phase:'uncertain',error:error.message}).catch(()=>{});
        message.textContent=error.message;
        if(!intent){save.disabled=skip.disabled=draft.disabled=reason.disabled=check.disabled=false;invalidate();}
      }
    };
    box.append(save,send,skip,message);
    if(row.communication) {
      message.textContent=`沟通状态：${BossReview.stateLabel(row.communication.state)}。已锁定以免重复操作；如结果不确定请到BOSS核对。`;
      const checked=el('button','我已核对BOSS，结束本条审核');checked.onclick=async event=>{if(!event.isTrusted)return;try{await request({type:'ACK_SEND_RESULT'});message.textContent='已结束本条审核，保留沟通记录且不会重复发送。可回到搜索页手动开始下一轮。';checked.disabled=true;}catch(error){message.textContent=error.message;}};box.append(checked);
    }
  }
  chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='SHOW_REVIEW')showReview().catch(()=>{});});
  async function boot() {
    const {intent}=await request({type:'GET_SEND_INTENT'});
    if(intent?.phase==='opening') {
      panel=shell('已确认的单次沟通');const status=el('p','正在核对当前会话是否对应已确认的职位…');panel.box.append(status);
      const stop=el('button','停止后续发送');stop.onclick=async event=>{if(!event.isTrusted)return;stopped=true;await request({type:'SEND_STEP',id:intent.id,phase:'uncertain',error:'使用者停止'}).catch(()=>{});status.textContent='已停止；平台已完成的操作请到BOSS核对。';};panel.box.append(stop);
      await sendChat(intent,text=>{status.textContent=text;});return;
    }
    if(detail) {const ready=await request({type:'DETAIL_READY'});if(!ready.collect)await showReview();}
  }
  boot().catch(()=>{});
})();
