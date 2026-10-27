/* 审核记录与发送状态的纯函数，不保存简历或Key。 */
(function (root) {
  'use strict';
  const PROMPT_VERSION = 'applicant-star-v2';
  const stateLabel = state => ({authorized:'已确认，尚未执行',opening:'已打开沟通，等待核对',dispatching:'已尝试发送，等待核对',ui_sent:'页面已显示本条话术',uncertain:'结果不明，请核对'})[state] || '请到BOSS核对';
  const now = () => new Date().toISOString();
  function draft(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('话术不能为空且不能超过2000字符');
    return text;
  }
  function editable(row) {
    if (row.communication) throw new Error('此职位已发起过沟通操作，请先在BOSS核对结果；不会自动重复发送');
  }
  function saveEdit(row, text, note = '', action = 'save') {
    editable(row);
    if (typeof text !== 'string' || text.length > 2000) throw new Error('话术不能超过2000字符');
    const previous = row.greeting || '';
    row.generatedGreeting ??= row.analysis?.greeting || previous;
    row.draftRevision ??= 0;
    if (previous === text && action === 'save') return null;
    row.draftRevision++;
    row.greeting = text;
    row.updatedAt = now();
    return {schemaVersion:1,action,at:now(),url:row.url,title:row.title,company:row.company,
      jd:row.jd || '',generated:row.generatedGreeting,before:previous,after:text,
      changed:previous !== text,note:String(note).slice(0,1000),revision:row.draftRevision,
      generation:row.generation || {promptVersion:'legacy',model:'unknown'},
      assessment:{status:row.status,pending:row.pending || [],gaps:row.gaps || []}};
  }
  function authorize(row, msg, tabId) {
    editable(row);
    if (row.status === 'skip' || !row.jd) throw new Error('此记录已跳过或缺少JD，不能发起沟通');
    draft(msg.greeting);
    if (msg.acknowledged !== true) throw new Error('请先确认职位和首次打招呼话术');
    if (msg.autoGreetingOff !== true) throw new Error('请先关闭BOSS自动招呼并确认，不允许默认招呼后补发');
    if (msg.revision !== (row.draftRevision || 0) || msg.greeting !== row.greeting) throw new Error('话术已变化，请重新加载并审核最新版本');
    const event = saveEdit(row,msg.greeting,msg.note,'confirm');
    const intent = {id:crypto.randomUUID(),url:row.url,title:row.title,company:row.company,
      recruiter:String(msg.recruiter || '').slice(0,200),greeting:row.greeting,
      sourceTabId:tabId,executorTabId:null,expiresAt:Date.now()+120000,phase:'authorized',mode:'first-greeting'};
    if (!intent.recruiter.trim()) throw new Error('未识别到招聘者姓名，请人工确认沟通对象');
    row.communication = {id:intent.id,state:'authorized',mode:'first-greeting',at:now(),text:row.greeting};
    return {intent,event};
  }
  function identityMatches(intent, identity) {
    return !!identity && identity.url === intent.url && identity.recruiter === intent.recruiter;
  }
  const api = {PROMPT_VERSION,stateLabel,draft,editable,saveEdit,authorize,identityMatches};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BossReview = api;
})(globalThis);
