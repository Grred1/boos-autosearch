/* DOM选择器沿用上游职位读取思路，无沟通按钮选择器。 */
(function () {
  'use strict';
  const pick = (root, selectors) => selectors.map(s => root.querySelector(s)).find(Boolean);
  const text = (root, selectors) => pick(root, selectors)?.textContent?.trim() || '';
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const names = ['.job-name','.job-title','[class*=job-name]'];
  const companies = ['.company-name','[class*=company-name]','.company-info a'];
  const salary = ['.job-salary','.salary','[class*=salary]','.money'];
  const city = ['.job-area','.job-area-wrapper','[class*=job-area]'];
  function risk(doc = document) {
    if (/\/captcha|\/verify|\/login|\/passport|\/safe\//i.test(location.pathname)) return '验证或登录页面';
    if (['.geetest_panel','.geetest_holder','[id*=captcha]','[class*=captcha]','iframe[src*=captcha]','.verify-wrap'].some(s => [...doc.querySelectorAll(s)].some(visible))) return '检测到验证码或验证界面';
    const warning = /访问过于频繁|操作过于频繁|请求过于频繁|访问受限|账号异常|账号被封|安全验证|安全检测|请完成验证|请先登录|登录已失效|重新登录|系统异常|服务异常/;
    const blocks = [...doc.querySelectorAll('[role=dialog],.dialog,.dialog-box,.modal,.error-content,.error-page,.tip-content')].filter(visible);
    if (blocks.some(el => warning.test(el.innerText || el.textContent))) return '检测到访问限制、登录失效或异常提示';
    const body = doc.body?.innerText || '';
    if (body.length < 4000 && warning.test(body)) return '页面提示需要验证、登录或暂时无法访问';
    return '';
  }
  function cards(doc = document) {
    const found = [...doc.querySelectorAll('.job-card-wrapper,li.job-card,div[data-jobid],.job-primary')].filter(visible);
    return found.filter(el => !found.some(other => other !== el && other.contains(el))).map(el => {
      const link = [...el.querySelectorAll('a[href]')].find(a => BossCore.jobURL(a.href));
      const url = link && BossCore.jobURL(link.href);
      return url ? {url,title:text(el,names) || link.textContent.trim(),company:text(el,companies),salary:text(el,salary),city:text(el,city),tags:text(el,['.tag-list','.job-info','.job-card-footer'])} : null;
    }).filter(Boolean);
  }
  function detail(doc = document) {
    return {title:text(doc,['.job-banner .name h1','.job-name','h1']),company:text(doc,companies),salary:text(doc,salary),city:text(doc,['.job-banner .text-city',...city]),tags:text(doc,['.job-banner .text-desc','.job-banner .info-primary p']),jd:text(doc,['.job-sec-text','.job-detail-section .text','.job-sec .text','.job-detail .text']).slice(0,16000)};
  }
  globalThis.BossDOM = {risk,cards,detail};
})();
