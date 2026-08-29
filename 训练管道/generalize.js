'use strict';
/**
 * FAQ 泛化：将逐题专属条目聚类为"侧重点分组"的主题条目
 * 流程: 聚类(LLM) → 通用条目生成(LLM) → 替换 FAQ → 隔离评分核验 → 迭代 refine
 * 用法: node 训练管道/generalize.js  [N=待核验题数, ROUND=1..3]
 * key 从 env / ~/.codex/skills/claude-vision/.env 读取（不硬编码）
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readFAQRuntime, writeFAQRuntime } = require('../scripts/lib-assistant-faq.js');

const root = path.join(__dirname, '..');
const W = p => path.join(root, p);
const rd = f => JSON.parse(fs.readFileSync(W(f), 'utf8').replace(/^﻿/, ''));
const wr = (f, d) => fs.writeFileSync(W(f), JSON.stringify(d, null, 2), 'utf8');
const exists = f => fs.existsSync(W(f));

const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = path.join(homeDir, '.codex/skills/claude-vision/.env');
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const getEnv = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const API_KEY = process.env.DEEPSEEK_KEY || getEnv('DEEPSEEK_KEY') || getEnv('DASHSCOPE_API_KEY');
const API_URL = (process.env.DEEPSEEK_KEY || getEnv('DEEPSEEK_KEY')) ? 'https://api.deepseek.com/v1/chat/completions' : (getEnv('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1') + '/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
if (!API_KEY) { console.error('缺少 DEEPSEEK_KEY'); process.exit(1); }

const ROUND = Number(process.env.ROUND || 1);
const CLUSTER_BATCH = 40;
const GEN_BATCH = 5;

function llm(messages, maxTokens = 16000, temp = 0.3) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: temp, reasoning_effort: 'low' });
    const req = https.request(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY } }, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => {
        const d = Buffer.concat(ch).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + d.slice(0, 200)));
        try { resolve(JSON.parse(d).choices[0].message.content); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}
function pj(t) {
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const r0 = f ? f[1] : t;
  const s = r0.indexOf('['); if (s < 0) throw new Error('no array');
  const e = r0.lastIndexOf(']');
  const sl = e > s ? r0.slice(s, e + 1) : r0.slice(s);
  try { return JSON.parse(sl); } catch (err) { const last = sl.lastIndexOf('}'); if (last > s) return JSON.parse(sl.slice(0, last + 1) + ']'); throw err; }
}
async function llmJ(system, user, temp = 0.3) {
  for (let a = 0; a < 3; a++) { try { const o = await llm([{ role: 'system', content: system }, { role: 'user', content: user }], 16000, temp); const it = pj(o); if (Array.isArray(it)) return it; } catch (e) { console.log('  重试', a + 1, e.message.slice(0, 60)); } }
  return null;
}
const normQ = s => String(s || '').toLowerCase().replace(/[^一-龥a-z0-9]/g, '');

// ---------- 数据 ----------
const faq = readFAQRuntime();
const spec = faq.filter(f => (f.q || '').length > 30);   // 逐题专属条目
const normal = faq.filter(f => (f.q || '').length <= 30);
console.log('FAQ:', faq.length, '| 逐题专属:', spec.length, '| 常规:', normal.length);

// ---------- Phase 1: 聚类（LLM, 分批） ----------
const CLUST_SYS = '你是 ChemAI 题目聚类官。把给定的一组实验题目按"侧重点/子主题"聚成若干组，同一组的题目侧重点相同（如都问"未沸腾除过量H₂O₂的后果"），不同组的侧重点不同。只输出 JSON 数组，每项：{"name":"组名(概括该组侧重点,≤14字)","ids":[成员题目id...],"distinctivePhrase":"该组题目的共同侧重点短语(≤10字,用于检索区分)"}。组数控制在题目数的1/4~1/3。题目间若侧重点差异小可并入同组。';
async function clusterAll() {
  const outFile = 'Agent工作区/Agent-优化/generalize_clusters_r' + ROUND + '.json';
  if (exists(outFile)) { console.log('[聚类] 复用', rd(outFile).length); return rd(outFile); }
  const clusters = [];
  for (let i = 0; i < spec.length; i += CLUSTER_BATCH) {
    const chunk = spec.slice(i, i + CLUSTER_BATCH);
    const user = '请为以下题目分组（每组给出 ids 与侧重点短语）：\n' + JSON.stringify(chunk.map(f => ({ id: 'E' + (i + chunk.indexOf(f)), question: (f.q || f.title).slice(0, 90), title: f.title })), null, 2);
    const items = await llmJ(CLUST_SYS, user) || [];
    // 修正 id 前缀
    items.forEach(c => { c.ids = (c.ids || []).map(x => 'E' + (typeof x === 'number' ? x : String(x).replace(/^E/, ''))); c.batch = i; });
    clusters.push(...items);
    console.log('[聚类] 批次完成, 累计组数', clusters.length);
  }
  wr(outFile, clusters);
  return clusters;
}

// ---------- Phase 2: 通用条目生成 ----------
const GEN_SYS = '你是 ChemAI 通用条目生成官。根据一组的多个相似题目及其标准参考答案，生成一条"主题通用"FAQ条目：答案要综合覆盖该组所有题目涉及的侧重点（力求任何一道组内题目都能从答案中找到其要点的完整回答，10分制≥9.5）。只输出 JSON 数组，每项：{"name":"组名","keys":["检索词≥8个,含组内题目共同与各自的关键术语,用于区分本组与其他组"],"ents":["实体词"],"title":"条目标题(概括该组侧重点,≤20字)","subfield":"17分类之一","answer":"综合答案(180~300字,覆盖该组各题目要点,以武汉大学讲义为准:6%H₂O₂=8mL等,分点但简洁)","detail":"补充细节(可含 corpus#数字)"}。数值以讲义为准。';
async function genEntries(clusters) {
  const outFile = 'Agent工作区/Agent-优化/generalize_entries_r' + ROUND + '.json';
  if (exists(outFile)) { console.log('[生成] 复用', rd(outFile).length); return rd(outFile); }
  const byId = {}; spec.forEach((f, i) => byId['E' + i] = f);
  const allQs = rd('Agent工作区/Agent-B-问题生成/self_train_all_599.json');
  const qByQ = {}; allQs.forEach(q => qByQ[q.question] = q);
  const entries = [];
  for (let i = 0; i < clusters.length; i += GEN_BATCH) {
    const chunk = clusters.slice(i, i + GEN_BATCH);
    const input = chunk.map(c => ({
      name: c.name, ids: c.ids,
      questions: (c.ids || []).map(id => { const f = byId[id]; return f ? { question: (f.q || f.title).slice(0, 110), ref: (qByQ[f.q] ? qByQ[f.q].referenceAnswer : '').slice(0, 160) } : null; }).filter(Boolean)
    }));
    const user = '请为每组生成一条通用FAQ条目：\n' + JSON.stringify(input, null, 2);
    const items = await llmJ(GEN_SYS, user) || [];
    items.forEach(x => { if (x && x.title && x.answer) entries.push(x); });
    console.log('[生成] 已生成', entries.length);
  }
  wr(outFile, entries);
  return entries;
}

// ---------- Phase 3: 替换 FAQ ----------
function rebuildArray(normalEntries, newEntries) {
  return normalEntries.concat(newEntries);
}
function mergeLexicon(newEntries) {
  const lexFile = '_archive/data_dev/academic_lexicon.json';
  const lex = rd(lexFile);
  let added = 0;
  for (const e of newEntries) {
    const b = lex.subfields[e.subfield]; if (!b) continue;
    for (const k of e.keys || []) if (!b.canonical_terms.includes(k)) { b.canonical_terms.push(k); added++; }
    for (const k of e.ents || []) if (!b.entity_terms.includes(k)) { b.entity_terms.push(k); added++; }
  }
  if (added) wr(lexFile, lex);
  return added;
}

// ---------- Phase 4: 隔离评分核验（599 题，仅 ROUND=1 全量，之后只评未达标+抽样） ----------
const SCORE_SYS = '你是 ChemAI 评分官。对每条给出"AI助手本地回复"对照"标准参考答案"的评分，满分10分。只输出 JSON 数组，每项：{"question":"原题","score":0-10小数一位}。评分准则：回复准确且覆盖参考答案关键点且与讲义一致→9.5以上；部分覆盖→6-9；答非所问→<6。';
async function verify(questions, onlyIds) {
  const la = require('./local_answer.js');
  la.reload();
  const results = [];
  const list = onlyIds ? questions.filter(q => onlyIds.includes(q.id)) : questions;
  for (const q of list) {
    const ans = la.answer(q.question).answerText.slice(0, 600);
    const entry = [{ question: q.question, referenceAnswer: (q.referenceAnswer || '').slice(0, 300), assistantAnswer: ans }];
    let o = null;
    for (let a = 0; a < 3 && !o; a++) { try { o = pj(await llm([{ role: 'system', content: SCORE_SYS }, { role: 'user', content: '请评分：\n' + JSON.stringify(entry, null, 2) }], 16000, 0)); } catch (e) {} }
    results.push({ id: q.id, question: q.question, score: o ? Number(o[0].score) : 0, matched: la.answer(q.question).matchedFAQ ? la.answer(q.question).matchedFAQ.title : null });
    if (results.length % 50 === 0) console.log('  已评', results.length);
  }
  wr('Agent工作区/Agent-C-答案评分/generalize_verify_r' + ROUND + '.json', results);
  return results;
}

(async () => {
  const allQs = rd('Agent工作区/Agent-B-问题生成/self_train_all_599.json');
  console.log('\n===== 泛化 Round ' + ROUND + ' =====');
  const clusters = await clusterAll();
  console.log('聚类组数:', clusters.length);
  const entries = await genEntries(clusters);
  console.log('通用条目:', entries.length);
  if (!entries.length) { console.error('无通用条目生成'); process.exit(1); }
  // 替换 FAQ（保留常规条目 + 新通用条目，移除逐题专属条目）
  const newNormal = normal.map(e => ({ keys: e.keys, ents: e.ents, title: e.title, q: e.q, subfield: e.subfield, answer: e.answer, detail: e.detail }));
  const newGen = entries.map(e => ({ keys: e.keys, ents: e.ents || [], title: e.title, q: e.q || '', subfield: e.subfield, answer: e.answer, detail: e.detail || '' }));
  writeFAQRuntime(rebuildArray(newNormal, newGen));
  const added = mergeLexicon(newGen);
  console.log('已替换: FAQ', faq.length, '→', newNormal.length + newGen.length, '（移除逐题专属', spec.length, '条, 新增通用', newGen.length, '条）| 词表新增', added);

  // 核验
  const onlyIds = ROUND === 1 ? null : (exists('Agent工作区/Agent-C-答案评分/generalize_verify_r' + (ROUND - 1) + '.json')
    ? rd('Agent工作区/Agent-C-答案评分/generalize_verify_r' + (ROUND - 1) + '.json').filter(r => r.score < 9.5).map(r => r.id) : null);
  const results = await verify(allQs, onlyIds);
  const n = results.map(r => r.score);
  console.log('\n核验: ' + results.length + ' 题 | avg=' + (n.reduce((a, b) => a + b, 0) / n.length).toFixed(2) + ' | ≥9.5=' + n.filter(s => s >= 9.5).length + '/' + n.length);
  const low = results.filter(r => r.score < 9.5);
  low.slice(0, 15).forEach(r => console.log('  <9.5:', r.id, r.score, '|', (r.matched || '').slice(0, 26), '|', r.question.slice(0, 40)));
  console.log('DONE ROUND ' + ROUND);
})().catch(e => { console.error(e); process.exit(1); });
