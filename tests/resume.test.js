const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {parseResume} = require('../src/resume');
const blank = ()=>JSON.parse(fs.readFileSync('config/resume.example.json','utf8'));
test('空白公开模板不能被当作已配置的简历',()=>assert.throws(()=>parseResume(JSON.stringify(blank())),/过少/));
test('完整简历文本优先，联系方式保留供本人决定发送范围',()=>{
 const d=blank();d.personal={name:'示例候选人',email:'demo@example.invalid',phone:'13800000000'};d.resumeText='教育背景与项目原文，只引用真实经历完成智能体系统开发。';d.skills=['不重复追加'];
 const result=parseResume(JSON.stringify(d));assert.match(result,/13800000000/);assert.match(result,/教育背景/);assert.ok(!result.includes('不重复追加'));
});
test('支持手工分区填写，不依赖原始PDF路径',()=>{
 const d=blank();d.education=['某大学计算机专业硕士，研究方向为机器学习'];d.projects=['负责检索模块与评测，成果依据真实记录填写'];
 const result=parseResume(JSON.stringify(d));assert.match(result,/教育背景/);assert.match(result,/项目经历/);
});
test('格式错误、额外Key字段、数组类型错误和超长原文均拒绝导入',()=>{
 assert.throws(()=>parseResume('not json'),/有效/);
 assert.throws(()=>parseResume(JSON.stringify({...blank(),apiKey:'not-a-real-key'})),/模板之外/);
 assert.throws(()=>parseResume(JSON.stringify({...blank(),projects:[{name:'不支持的对象'}]})),/文本数组/);
 assert.throws(()=>parseResume(JSON.stringify({...blank(),resumeText:'字'.repeat(24001)})),/24000/);
 assert.throws(()=>parseResume('x'.repeat(1024*1024+1)),/1MB/);
});
test('个人简历路径始终被忽略，公开模板被保留',()=>{
 const cp=require('node:child_process');
 assert.equal(cp.spawnSync('git',['check-ignore','-q','local/resume.json']).status,0);
 assert.notEqual(cp.spawnSync('git',['check-ignore','-q','config/resume.example.json']).status,0);
 assert.equal(cp.execFileSync('git',['ls-files','local'],{encoding:'utf8'}),'');
 const template=blank();assert.deepEqual(template.personal,{name:'',email:'',phone:''});assert.equal(template.resumeText,'');
});
