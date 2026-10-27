/* 复用上游关键词筛选及薪资解析思路，Apache-2.0。纯函数可离线验证。 */
(function (root) {
  'use strict';
  const defaults = { keywords:'Agent,智能体,算法,AI,大模型,LLM,RAG', excludes:'AI销售,课程推广,数据标注', cities:'', salaryMin:0, graduationYear:'', direction:'all', maxJobs:5, intervalSeconds:60, roundRestMinutes:30, resume:'', aiEnabled:false, model:'deepseek-chat', provider:'deepseek', consent:false, redactResume:true, reviewOnMatch:true, autoContinue:true, fullTimeOnly:true };
  const words = x => String(x || '').split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean);
  const contains = (text, term) => /^[a-z]+$/i.test(term) ? new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i').test(text) : String(text).toLowerCase().includes(term.toLowerCase());
  function normalizeConfig(raw = {}) {
    const c = { ...defaults, ...raw };
    const n = (x, fallback, min, max) => Number.isFinite(Number(x)) ? Math.max(min, Math.min(max, Number(x))) : fallback;
    c.maxJobs = Math.floor(n(c.maxJobs,5,1,20)); c.intervalSeconds = n(c.intervalSeconds,60,30,3600);
    c.roundRestMinutes = n(c.roundRestMinutes,30,5,1440); c.salaryMin = n(c.salaryMin,0,0,1000);
    c.graduationYear = /^20\d{2}$/.test(String(c.graduationYear)) ? String(c.graduationYear) : '';
    if (!['all','application','algorithm'].includes(c.direction)) c.direction = 'all';
    if (!['deepseek','openai'].includes(c.provider)) c.provider = 'deepseek';
    c.redactResume = c.redactResume !== false;
    for (const key of ['aiEnabled','consent','reviewOnMatch','autoContinue','fullTimeOnly']) c[key] = c[key] === true;
    for (const key of ['keywords','excludes','cities','resume','model']) c[key] = typeof c[key] === 'string' ? c[key] : defaults[key];
    return c;
  }
  function jobURL(raw) {
    try { const u = new URL(raw,'https://www.zhipin.com'); return u.origin === 'https://www.zhipin.com' && /^\/job_detail\/[a-z\d_-]+\.html$/i.test(u.pathname) ? u.origin + u.pathname : null; } catch { return null; }
  }
  function parseSalary(raw) {
    const text = String(raw || '').replace(/\s/g,'');
    const unknown = { raw:String(raw || ''), min:null, max:null, months:null, annualMin:null, annualMax:null, unit:'unknown' };
    if (!text || /面议|[\uE000-\uF8FF]/.test(text)) return unknown;
    const months = text.match(/[·•×*](\d{1,2})薪?/);
    const period = /\/天|\/日|日薪/.test(text) ? 'day' : /\/时|\/小时|时薪/.test(text) ? 'hour' : /年薪|\/年/.test(text) ? 'year' : 'month';
    const m = text.match(/^(?:月薪|年薪|日薪|时薪)?(\d+(?:\.\d+)?)([kK千万元]?)(?:[-~–—至](\d+(?:\.\d+)?)([kK千万元]?))?/);
    if (!m) return unknown;
    const unit = m[4] || m[2];
    if (!unit && period === 'month') return unknown;
    const factor = u => /万/.test(u) ? 10 : /[kK千]/.test(u) ? 1 : 0.001;
    const min = Number(m[1]) * factor(m[2] || unit);
    const max = m[3] ? Number(m[3]) * factor(m[4] || unit) : /以上/.test(text) ? null : min;
    if (max !== null && max < min) return unknown;
    const count = months && Number(months[1]) >= 12 && Number(months[1]) <= 24 ? Number(months[1]) : null;
    return { raw:String(raw || ''), min, max, months:count, unit:period,
      annualMin:period === 'year' ? min : period === 'month' && count ? min * count : null,
      annualMax:period === 'year' ? max : period === 'month' && count && max !== null ? max * count : null };
  }
  function salaryCheck(s, floor) {
    if (s.unit !== 'month' || s.min === null) return {status:'review',reason:'薪资缺失、无法解析或非月薪，需确认'};
    if (s.min >= floor) return {status:'pass',reason:'月薪下限达标'};
    if (s.max === null || s.max >= floor) return {status:'review',reason:'仅薪资上限可能达标，需确认'};
    return {status:'skip',reason:'薪资上限低于门槛'};
  }
  function eligibility(text, year) {
    if (/不接受应届|非应届|仅限社招/.test(text)) return {status:'skip',reason:'明确不接受应届或仅限社招'};
    const campus = /应届|校招|校园招聘|毕业生/.test(text);
    if (!campus && /[1-9一二三四五六七八九十]+(?:[-~至][1-9一二三四五六七八九十]+)?年(?:以上)?(?:工作)?经验|经验[^\n]{0,8}[1-9]\s*年/.test(text)) return {status:'skip',reason:'要求有年限的工作经验，未明确接受应届'};
    const notes = [];
    const years = [...text.matchAll(/(20\d{2}|\d{2})(?:届|年毕业)/g)].map(m => m[1].length === 2 ? '20'+m[1] : m[1]);
    const labelYears=[];
    for(const match of text.matchAll(/毕业(?:时间|年份)\s*[:：]\s*(20\d{2})\s*年?(?:\s*[-–—~至到]\s*(20\d{2}))?/g)) {
      const start=Number(match[1]),end=Number(match[2] || match[1]);
      if(end>=start && end-start<=15) for(let y=start;y<=end;y++){years.push(String(y));labelYears.push(String(y));}
    }
    if(year && labelYears.length && !labelYears.includes(String(year))) return {status:'skip',reason:`JD明确毕业范围不包含${year}届`};
    if (year && years.length && !years.includes(String(year))) notes.push('JD 毕业年份与设置不同，需核对范围');
    if (!year) notes.push('未配置毕业年份');
    else if (!years.length) notes.push('JD未注明毕业年份范围');
    if (!campus) notes.push('是否接受应届生不明确');
    return {status:notes.length ? 'review':'pass',reason:notes.join('；') || 'JD 明确面向应届或校招，仍需核对具体资格'};
  }
  function assess(job, config, detailed = false) {
    const c = normalizeConfig(config), text = [job.title,job.tags,job.jd].filter(Boolean).join('\n');
    const salaryInfo = parseSalary(job.salary), pay = salaryCheck(salaryInfo,c.salaryMin), reasons = [], pending = [];
    const excluded = words(c.excludes).find(w => contains(text,w));
    if (excluded) reasons.push(`命中排除词：${excluded}`);
    if(c.fullTimeOnly && (/实习/.test(job.title || '') && !/全职|转正/.test(job.title || '') || /(?:元|\/)\s*[\/／]?\s*[天日]|日薪/.test(job.salary || ''))) reasons.push('当前仅筛选全职，跳过日薪或实习岗位');
    if (words(c.keywords).length && !words(c.keywords).some(w => contains(text,w))) reasons.push('未命中目标方向关键词');
    const cities = words(c.cities);
    if (cities.length && job.city && !cities.some(w => job.city.includes(w))) reasons.push('城市不匹配');
    if (cities.length && !job.city) pending.push('城市缺失');
    if (pay.status === 'skip') reasons.push(pay.reason);
    if (pay.status === 'review') pending.push(pay.reason);
    const app = /agent|智能体|RAG|大模型应用|工具调用|LLM应用/i.test(text), algo = /算法|训练|微调|机器学习|深度学习|NLP/i.test(text);
    const direction = app && algo ? '应用与算法交叉' : app ? 'Agent／大模型应用' : algo ? '算法／模型训练' : 'AI相关，方向待确认';
    if (detailed && c.direction === 'application' && !app) pending.push('未明确涉及Agent／大模型应用开发');
    if (detailed && c.direction === 'algorithm' && !algo) pending.push('未明确涉及算法／模型训练');
    const campus = eligibility(text,c.graduationYear);
    if (campus.status === 'skip') reasons.push(campus.reason);
    if (detailed && campus.status === 'review') pending.push(campus.reason);
    if (detailed && !job.jd) pending.push('JD未读取成功');
    return {status:reasons.length ? 'skip' : pending.length ? 'review' : 'candidate',reasons,pending,salaryInfo,direction,eligibility:campus.reason};
  }
  function discoveryOrder(jobs,config) {
    const c=normalizeConfig(config);
    const score=job=>{const t=job.title || '';return (c.graduationYear && new RegExp(`${c.graduationYear}|${c.graduationYear.slice(2)}届`).test(t)?20:0)+(/校招|应届|管培/.test(t)?10:0)+(salaryCheck(parseSalary(job.salary),c.salaryMin).status==='pass'?5:0);};
    return jobs.map((job,index)=>({job,index,score:score(job)})).sort((a,b)=>b.score-a.score || a.index-b.index).map(x=>x.job);
  }
  const redact = text => String(text || '').replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g,'[手机号已移除]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[邮箱已移除]');
  function validateAnalysis(v) {
    if (!v || !['match','review','skip'].includes(v.verdict) || !['reasons','gaps','pending'].every(k => Array.isArray(v[k]) && v[k].every(x => typeof x === 'string')) || typeof v.greeting !== 'string' || (v.verdict !== 'skip' && !v.greeting.trim())) throw new Error('模型返回格式不正确');
    if (/(?:同学|先生|女士)你好|看到你在|你的.{0,15}(?:经验|背景)|我们(?:的)?(?:公司|团队|岗位|AI中台)|欢迎(?:你)?加入/.test(v.greeting)) throw new Error('话术口吻像招聘方，请重新分析生成应聘者开场白');
    return {verdict:v.verdict,reasons:v.reasons,gaps:v.gaps,pending:v.pending,greeting:v.verdict === 'skip' ? '' : v.greeting.slice(0,600)};
  }
  const api = {defaults,words,contains,normalizeConfig,jobURL,parseSalary,salaryCheck,eligibility,assess,redact,validateAnalysis,discoveryOrder};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BossCore = api;
})(globalThis);
