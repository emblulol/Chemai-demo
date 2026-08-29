'use strict';
/**
 * ChemAI 一键全量检查（更便捷的渠道）
 * 用法: node scripts/check-all.js
 * 覆盖: ①全站乱码 ②FAQ 渲染 ③语料健康 ④assistant 语法/函数 ⑤题库/细则
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { execSync } = require('child_process');

let ok = true;
function pass(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.log('  ❌ ' + msg); ok = false; }

console.log('========== ChemAI 全量检查 ==========\n');

// 1. 乱码扫描
console.log('【1. 全站乱码扫描】');
const files = ['assistant.html','main.html','corpus.html','prep.html','knowledge.html','index.html',
  'data/corpus.json','_archive/data_dev/academic_lexicon.json','data/questions_bank.json','data/report_rubric.json','data/manual.json','data/kg.json'];
let badTotal = 0;
for (const f of files) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  badTotal += (s.match(/�/g) || []).length;
}
badTotal === 0 ? pass('全部 ' + files.length + ' 文件无 �') : fail('发现 ' + badTotal + ' 处 �');

// 2. FAQ 渲染审计
console.log('\n【2. FAQ 渲染审计】');
try {
  const out = execSync('node "' + path.join(__dirname, 'render-audit.js') + '"', { encoding: 'utf8' });
  const m = out.match(/问题 (\d+) 段|问题 (\d+)/);
  process.stdout.write(out.split('\n').slice(0, 2).join('\n') + '\n');
  if (out.includes('❌')) fail('FAQ 渲染有 ' + (m ? m[1] || m[2] : '?') + ' 段问题'); else pass('FAQ 渲染干净');
} catch (e) { fail('FAQ 渲染审计失败: ' + e.message.split('\n')[0]); }

// 3. 语料健康
console.log('\n【3. 语料健康】');
try {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/corpus.json'), 'utf8').replace(/^﻿/, ''));
  const ids = new Set(), dupP = {}, badSub = [];
  const canon = new Set(['合成制备','反应原理','实验操作','分析测定','光化学应用','结构表征','磁性研究','热分析','安全与废物处理','配位化学理论','实验教学','综合研究','化学史','高等理论','蓝晒工艺','摩尔盐相关','草酸配合物']);
  let dupId = 0;
  for (const e of c.entries) { if (ids.has(e.id)) dupId++; ids.add(e.id); const k = e.path.toLowerCase(); dupP[k] = (dupP[k] || 0) + 1; if (e.subfield && !canon.has(e.subfield)) badSub.push(e.id); }
  const dupPath = Object.values(dupP).filter(v => v > 1).length;
  if (c.total === c.entries.length && dupId === 0 && dupPath === 0 && badSub.length === 0) pass('total=' + c.total + ' 条，id/路径/分类均健康');
  else fail('语料异常: 重复id=' + dupId + ' 重复path=' + dupPath + ' 非法分类=' + badSub.length);
} catch (e) { fail('语料检查失败: ' + e.message); }

// 4. assistant 语法 + 函数
console.log('\n【4. assistant 语法与函数】');
try {
  const d = execSync('node "' + path.join(ROOT, '_archive/js/_diag.js') + '" assistant.html', { encoding: 'utf8' });
  if (d.includes('0 unclosed')) pass('assistant.html 括号平衡 0 unclosed'); else fail('assistant 括号不平衡');
} catch (e) { fail('diag 失败: ' + e.message.split('\n')[0]); }
const a = fs.readFileSync(path.join(ROOT, 'assistant.html'), 'utf8');
const needFns = ['handleQA','matchFAQ','renderRichAnswer','reportAnalysisHTML','calcMolar','recordLastQA','renderWrongBook','handleFileUpload','extractSearchKeywords','switchTab'];
const missingFns = needFns.filter(f => !a.includes('function ' + f + '('));
missingFns.length ? fail('缺函数: ' + missingFns.join(',')) : pass('核心函数齐全');

console.log('\n========== 检查完成：' + (ok ? '全部通过 ✅' : '存在问题 ❌') + ' ==========');
process.exit(ok ? 0 : 1);
