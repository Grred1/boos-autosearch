/* 仅操作正常可见网页控件；不能核实职位链接和招聘者时拒绝发送。 */
(function () {
  'use strict';
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const all = (root,s) => [...root.querySelectorAll(s)].filter(visible);
  const unique = items => { const xs=[...new Set(items)];return xs.length===1?xs[0]:null; };
  const exact = (root,s,t) => unique(all(root,s).filter(el=>el.textContent.trim()===t));
  function recruiter(doc=document) {
    const known=all(doc,'.job-boss-info h2,.boss-info h2,.boss-info .name,.boss-info-attr .name,.boss-name h2,.job-boss-info .name');
    const values=[...new Set(known.map(el=>el.textContent.trim()).filter(Boolean))];
    if (values.length===1) return values[0];
    const fallback=all(doc,'h2').map(el=>el.textContent.trim()).filter(x=>/^[\u4e00-\u9fffA-Za-z·]{1,12}(?:先生|女士)$/.test(x));
    return fallback.length===1?fallback[0]:'';
  }
  function entry(doc=document) {
    return exact(doc,'.job-banner a,.job-banner button,a.op-btn-chat,button.op-btn-chat','立即沟通') ||
      exact(doc,'.job-banner a,.job-banner button,a.op-btn-chat,button.op-btn-chat','继续沟通');
  }
  function continuation(doc=document) {
    const dialogs=all(doc,'[role=dialog],.dialog,.dialog-box,.modal');
    return unique(dialogs.flatMap(d=>all(d,'a,button').filter(el=>/^(继续沟通|继续聊天)$/.test(el.textContent.trim()))));
  }
  function chat(doc=document) {
    const input=unique(all(doc,'#chat-input,textarea.chat-input,textarea[placeholder*="说点什么"],[contenteditable="true"].chat-input'));
    if (!input) return null;
    const container=input.closest('.chat-conversation,.chat-container,.chat-window,.chat-box,.chat-content');
    if (!container) return null;
    // 只从当前会话顶部读取身份；聊天历史、左侧联系人列表和推荐职位不作为证据。
    const headers=all(container,'.chat-head,.chat-header,.chat-info,.chat-job-info,.chat-title,.job-info');
    const urls=[...new Set(headers.flatMap(h=>all(h,'a[href*="/job_detail/"]').map(a=>BossCore.jobURL(a.href)).filter(Boolean)))];
    const names=[...new Set(headers.flatMap(h=>all(h,'.boss-name,.name,[class*=boss-name]')).map(x=>x.textContent.trim()).filter(Boolean))];
    const send=exact(container,'button,.btn-send,.chat-send,[role=button]','发送');
    return {input,container,send,identity:{url:urls.length===1?urls[0]:null,recruiter:names.length===1?names[0]:null}};
  }
  const readInput = input => input.isContentEditable ? input.innerText : input.value;
  function fill(input,text) {
    if (readInput(input).trim()) throw new Error('聊天输入框已有内容，请自行核对，助手不会覆盖');
    input.focus();
    if (input.isContentEditable) input.textContent=text;
    else {
      const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,text);
    }
    input.dispatchEvent(new Event('input',{bubbles:true}));
    if (readInput(input)!==text) throw new Error('输入内容与确认的话术不同，已停止');
  }
  function sentMessages(container) {
    return all(container,'.message-item.is-self .text,.message-item.is-self .message-text,.message-item.right .text,.message-item.right .message-text,.chat-message.is-self .text');
  }
  const echoes=(container,text)=>sentMessages(container).filter(el=>el.textContent.trim()===text.trim()).length;
  globalThis.BossChatDOM={visible,recruiter,entry,continuation,chat,readInput,fill,echoes};
})();
