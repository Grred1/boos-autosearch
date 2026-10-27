/* 本地JSON简历导入，无网络或账号凭据读取。 */
(function (root) {
  'use strict';
  const sections = {education:'教育背景',skills:'专业技能',experience:'实习与工作经历',projects:'项目经历',publications:'论文成果'};
  function parseResume(source) {
    if (typeof source !== 'string' || source.length > 1024 * 1024) throw new Error('简历JSON需小于1MB');
    let value;
    try { value = JSON.parse(source.replace(/^\uFEFF/,'')); } catch { throw new Error('不是有效的JSON文件'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) throw new Error('请使用schemaVersion为1的简历模板');
    if (Object.keys(value).some(k => !['schemaVersion','personal','resumeText',...Object.keys(sections)].includes(k))) throw new Error('简历包含模板之外的字段，请勿在简历文件中保存Key等配置');
    const parts = [];
    if (value.personal !== undefined) {
      if (!value.personal || Array.isArray(value.personal) || typeof value.personal !== 'object' || Object.keys(value.personal).some(k=>!['name','email','phone'].includes(k))) throw new Error('personal仅支持name、email、phone');
      const personal = Object.values(value.personal);
      if (personal.some(x=>typeof x !== 'string')) throw new Error('个人信息字段需为文本');
      if (personal.some(x=>x.trim())) parts.push(personal.map(x=>x.trim()).filter(Boolean).join(' · '));
    }
    if (value.resumeText !== undefined && typeof value.resumeText !== 'string') throw new Error('resumeText需为完整简历文本');
    for (const [key,title] of Object.entries(sections)) {
      if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(x=>typeof x !== 'string'))) throw new Error(`${title}需为文本数组`);
    }
    // PDF提取时以完整原文为准；手工整理时可留空resumeText，使用分区字段。
    if (value.resumeText?.trim()) parts.push(value.resumeText.trim());
    else for (const [key,title] of Object.entries(sections)) {
      const lines = (value[key] || []).map(x=>x.trim()).filter(Boolean);
      if (lines.length) parts.push(title+'\n'+lines.join('\n'));
    }
    const text = parts.join('\n\n');
    if (text.length < 20) throw new Error('模板为空或简历内容过少，请先填写');
    if (text.length > 24000) throw new Error('简历超过24000字符，请精简后再导入，避免静默截断');
    return text;
  }
  const api = {parseResume};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BossResume = api;
})(globalThis);
