/**
 * ChemAI 增强训练管线 v3 (总集 + 语料库校准)
 * 整合原 run_10cycle_v2.js / run_4agents_200q.js / run_5cycle.js
 *
 * 五代理架构:
 *   戊(Corpus Calibrator) → 甲(Trainer)→乙(Generator)→丁(Validator)→丙(Scorer)
 *   - 阶段0: 遍历291条文献语料库校准全部FAQ答案
 *   - 阶段1-N: 四代理标准训练循环
 * 所有结果写入总集 reports_master.json
 *
 * 用法:
 *   node run_pipeline.js                   — 默认: 30轮, 全17分类, 102题/轮, 全pro模型
 *   node run_pipeline.js --cycles 10       — 自定义轮数
 *   node run_pipeline.js --mode quick      — 快速模式 (50题/轮, 14分类, 轻量模型)
 *   node run_pipeline.js --mode full       — 完整模式 (102题/轮, 17分类, 全pro模型, 30轮)
 *   node run_pipeline.js --mode single     — 单轮200题模式
 *   node run_pipeline.js --sync-html       — 额外同步FAQ到assistant.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = path.join(__dirname, '..');
const API_KEY = process.env.DEEPSEEK_KEY || '';
if (!API_KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量，请先设置后运行');
  process.exit(1);
}
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// ===== 配置 =====
const CONFIGS = {
  quick: {
    model: 'deepseek-flash', modelFlash: 'deepseek-flash',
    cycles: 10, questionsPerCycle: 50, rateMs: 300,
    excludedCats: ['蓝晒工艺', '摩尔盐相关', '草酸配合物'],
    description: '快速模式 — deepseek-flash, 50题/轮, 14分类'
  },
  full: {
    model: 'deepseek-flash', modelFlash: 'deepseek-flash',
    cycles: 30, questionsPerCycle: 102, rateMs: 200,
    excludedCats: [],
    description: '完整模式 — deepseek-flash全代理, 102题/轮, 17分类全覆盖, 30轮'
  },
  single: {
    model: 'deepseek-flash', modelFlash: 'deepseek-flash',
    cycles: 1, questionsPerCycle: 200, rateMs: 150,
    excludedCats: [],
    description: '单轮模式 — 200题, 17分类加权分配'
  }
};

// 解析命令行参数
function parseArgs() {
  const args = { mode: 'full', cycles: null, syncHtml: false, resume: true, noResume: false };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--mode' && process.argv[i + 1]) {
      args.mode = process.argv[++i];
    } else if (process.argv[i] === '--cycles' && process.argv[i + 1]) {
      args.cycles = parseInt(process.argv[++i]);
    } else if (process.argv[i] === '--sync-html') {
      args.syncHtml = true;
    } else if (process.argv[i] === '--resume') {
      args.resume = true; args.noResume = false;
    } else if (process.argv[i] === '--no-resume') {
      args.resume = false; args.noResume = true;
    }
  }
  return args;
}

const CLI = parseArgs();
const CFG = CONFIGS[CLI.mode] || CONFIGS.full;
if (CLI.cycles) CFG.cycles = CLI.cycles;

console.log('配置: ' + CFG.description);
console.log('周期: ' + CFG.cycles + ' | 模型: ' + CFG.model + ' | 速率: ' + CFG.rateMs + 'ms');

// ===== 数据加载 =====
function readJSON(fp) {
  let r = fs.readFileSync(fp, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.slice(1);
  return JSON.parse(r);
}

const FAQ = readJSON(path.join(BASE, 'data', 'faq_unified.json'));
const KB = readJSON(path.join(BASE, '_archive', 'data_dev', 'kb.json'));
const MANUAL = readJSON(path.join(BASE, 'data', 'manual.json'));
const CATS = readJSON(path.join(BASE, '_archive', 'data_dev', 'categories.json'));
const CORPUS = readJSON(path.join(BASE, 'data', 'corpus.json'));
const INITIAL_FAQ = FAQ.length;

// 活跃分类 (排除指定分类)
const ACTIVE_CATS = CATS.canonical.filter(c => !CFG.excludedCats.includes(c));

// ===== 分类→手册章节映射 =====
const CAT_CH_MAP = {
  '合成制备':        { ch: [3, 4], focus: '制备原理、操作步骤、投料比、产率计算' },
  '反应原理':        { ch: [3], focus: '氧化还原反应、配位反应方程式、反应机理、中间体' },
  '实验操作':        { ch: [4, 12], focus: '过滤、结晶、洗涤、干燥、称量、故障排查' },
  '分析测定':        { ch: [5], focus: '滴定分析、KMnO₄标定、含量测定、定量检测' },
  '光化学应用':      { ch: [6], focus: '光化学反应、LMCT、蓝晒、避光操作、量子产率' },
  '结构表征':        { ch: [2, 5], focus: 'UV-Vis、IR、XRD、晶体结构、颜色外观、晶系' },
  '磁性研究':        { ch: [5, 7], focus: '磁化率、磁矩、磁天平、顺磁/抗磁、高自旋d⁵' },
  '热分析':          { ch: [5], focus: 'TG-DSC、热分解、脱水温度、热稳定性、失重分析' },
  '安全与废物处理':  { ch: [8], focus: '安全规范、废液分类、回收处理、急救措施、MSDS' },
  '配位化学理论':    { ch: [7], focus: '晶体场理论、CFSE、高/低自旋、Jahn-Teller、光谱化学序' },
  '实验教学':        { ch: [9, 11], focus: '教学目标、思政素养、实验报告、考核方式' },
  '综合研究':        { ch: [10], focus: '跨章节综合、对比分析、扩展知识、前沿进展' },
  '化学史':          { ch: [1], focus: '配位化学发展史、诺贝尔奖、关键发现、奠基人物' },
  '高等理论':        { ch: [7, 10], focus: '量子化学计算、分子轨道、热力学参数、动力学模型' },
  '蓝晒工艺':        { ch: [6], focus: '蓝晒原理、光敏剂、曝光参数、显影定影、图像质量' },
  '摩尔盐相关':      { ch: [1, 3], focus: '莫尔盐制备、性质、纯度分析' },
  '草酸配合物':      { ch: [2, 3], focus: '草酸根配位模式、其他草酸配合物、对比研究' },
};

function catManualRef(cat) {
  const m = CAT_CH_MAP[cat]; if (!m) return '';
  const chs = MANUAL.chapters || [];
  return m.ch.map(n => {
    const c = chs[n - 1];
    return c ? '【' + c.title + '】\n' + (c.sections || []).map(s => s.title + ': ' + (s.content || '').slice(0, 300)).join('\n') : '';
  }).join('\n');
}

// ===== RAG Pipeline (共享) =====
const SUBMAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁻': '-', '⁺': '+' };
const norm = s => String(s || '').toLowerCase().replace(/[₀₁₂₃₄₅₆₇₈₉⁻⁺]/g, c => SUBMAP[c] || c).replace(/\s+/g, '');
const AMB = new Set(['℃', '°c', '40', '40℃', '100', '100℃', '0', '0℃', '20', '20℃', 'g', 'ml', 'mol', '%', 'h', 'ph', '水', '酸', '碱', '盐', '色', '热', '光', '铁', '氧', '氢', '碳']);

function matchFAQ(q) {
  const nq = norm(q); let best = null, bs = 0;
  const qbg = new Set(); for (let i = 0; i < nq.length - 1; i++) qbg.add(nq.slice(i, i + 2));
  for (const f of FAQ) {
    let kh = 0, sh = 0;
    for (const k of (f.keys || [])) { const nk = norm(k); if (nk.length < 2 || AMB.has(nk)) continue; if (nq.includes(nk)) { kh++; if (nk.length >= 4) sh++; } }
    let eh = 0; for (const en of (f.ents || [])) { if (norm(en).length >= 2 && nq.includes(norm(en))) eh++; }
    const ft = norm((f.title || '') + ' ' + (f.answer || '')); const fbg = new Set();
    for (let i = 0; i < ft.length - 1; i++) fbg.add(ft.slice(i, i + 2));
    let bg = 0; for (const b of qbg) { if (fbg.has(b)) bg++; }
    const sc = kh * 3 + sh * 6 + eh * 8 + Math.min(bg * 0.4, 15);
    if ((kh >= 1 || eh >= 1 || bg >= 15) && sc >= bs) { bs = sc; best = f; }
  }
  return best;
}

function kbTokens(text) {
  const s = norm(String(text || '')); const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[一-鿿]/.test(c)) { let j = i; while (j < s.length && /[一-鿿]/.test(s[j])) j++; const run = s.slice(i, j); for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2)); i = j; }
    else if (/[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(c)) { let j = i; while (j < s.length && /[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(s[j])) j++; const tk = s.slice(i, j); if (tk.length >= 2 || /\d/.test(tk)) out.push(tk); i = j; }
    else i++;
  }
  return out;
}

let BM25_IDX = null;
function kbIndex() {
  if (BM25_IDX) return BM25_IDX;
  const docs = KB.map(en => { const parts = []; kbTokens(en.topic || '').forEach(x => { parts.push(x, x, x); }); kbTokens((en.keys || []).join(', ')).forEach(x => { parts.push(x, x); }); kbTokens(en.answer || '').forEach(x => parts.push(x)); const tf = {}; parts.forEach(x => tf[x] = (tf[x] || 0) + 1); return { en, tf, len: parts.length || 1 }; });
  const df = {}; let tot = 0; docs.forEach(d => { tot += d.len; for (const t in d.tf) df[t] = (df[t] || 0) + 1; });
  BM25_IDX = { docs, df, avgdl: tot / (docs.length || 1), N: docs.length }; return BM25_IDX;
}

function bm25MatchKB(q) {
  const idx = kbIndex(); const qtoks = kbTokens(q).filter(t => t.length >= 2); const nq = norm(q); const k1 = 1.5, b = 0.75; const arr = [];
  for (const d of idx.docs) { let sc = 0; for (const t of qtoks) { const f = d.tf[t]; if (!f) continue; const idf = Math.log(1 + (idx.N - idx.df[t] + 0.5) / (idx.df[t] + 0.5)); sc += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / idx.avgdl)); } for (const k of (d.en.keys || [])) { const nk = norm(k); if (nk.length >= 3 && nq.includes(nk)) sc += 6; } for (const t of (d.en.ents || [])) { const nt = norm(t); if (nt.length >= 2 && nq.includes(nt)) sc += 8; } if (sc <= 0) continue; arr.push({ en: d.en, score: sc }); }
  if (!arr.length) return null; arr.sort((a, b2) => b2.score - a.score); if (arr[0].score < 3.0) return null;
  return { entry: arr[0].en, score: arr[0].score, second: arr[1] ? arr[1].en : null };
}

// ===== 语料库 BM25 索引 =====
let CORPUS_IDX = null;
function corpusIndex() {
  if (CORPUS_IDX) return CORPUS_IDX;
  const docs = CORPUS.entries.map(en => {
    const parts = [];
    kbTokens(en.title || '').forEach(x => { parts.push(x, x, x); });
    kbTokens(en.abstract || '').forEach(x => { parts.push(x, x); });
    kbTokens((en.objects || '')).forEach(x => { parts.push(x, x); });
    kbTokens((en.methods || '')).forEach(x => parts.push(x));
    kbTokens((en.questions || []).join(' ')).forEach(x => parts.push(x));
    const tf = {}; parts.forEach(x => tf[x] = (tf[x] || 0) + 1);
    return { en, tf, len: parts.length || 1 };
  });
  const df = {}; let tot = 0;
  docs.forEach(d => { tot += d.len; for (const t in d.tf) df[t] = (df[t] || 0) + 1; });
  CORPUS_IDX = { docs, df, avgdl: tot / (docs.length || 1), N: docs.length };
  return CORPUS_IDX;
}

function bm25MatchCorpus(q, subfield) {
  const idx = corpusIndex(); const qtoks = kbTokens(q).filter(t => t.length >= 2);
  const nq = norm(q); const k1 = 1.5, b = 0.75; const arr = [];
  for (const d of idx.docs) {
    let sc = 0;
    for (const t of qtoks) { const f = d.tf[t]; if (!f) continue; const idf = Math.log(1 + (idx.N - idx.df[t] + 0.5) / (idx.df[t] + 0.5)); sc += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / idx.avgdl)); }
    if (subfield && d.en.subfield === subfield) sc += 5;
    if (d.en.objects) { const nobj = norm(d.en.objects); if (nobj.length >= 2 && nq.includes(nobj)) sc += 4; }
    if (d.en.methods) { const nm = norm(d.en.methods); if (nm.length >= 2 && nq.includes(nm)) sc += 3; }
    for (const qq of (d.en.questions || [])) { const nqq = norm(qq); if (nqq.length >= 4 && nq.includes(nqq.slice(0, 4))) sc += 6; }
    if (sc <= 0) continue; arr.push({ en: d.en, score: sc });
  }
  if (!arr.length) return [];
  arr.sort((a, b2) => b2.score - a.score);
  if (arr[0].score < 2.5) return [];
  return arr.slice(0, 3);
}

function corpusContext(q, subfield) {
  const matches = bm25MatchCorpus(q, subfield);
  if (!matches.length) return '';
  return matches.map((m, i) => {
    const e = m.en;
    let ctx = '【语料#' + e.id + ' · ' + (e.title || '').slice(0, 80) + '】';
    if (e.journal) ctx += '\n期刊: ' + e.journal + (e.volume ? ' Vol.' + e.volume : '') + (e.issue ? '(' + e.issue + ')' : '') + (e.pages ? ' pp.' + e.pages : '');
    if (e.doi) ctx += '\nDOI: ' + e.doi;
    if (e.abstract) ctx += '\n摘要: ' + e.abstract.slice(0, 400);
    if (e.objects) ctx += '\n研究对象: ' + e.objects;
    if (e.methods) ctx += '\n方法: ' + e.methods;
    return ctx;
  }).join('\n\n');
}

function buildContext(q, subfield) {
  const parts = [];
  const faq = matchFAQIndexed(q) || matchFAQ(q);  // #5: prefer indexed O(1) lookup
  if (faq) parts.push('【FAQ · ' + faq.title + '】\n' + (faq.answer || '') + (faq.detail ? '\n' + faq.detail : ''));
  const m = bm25MatchKB(q);
  if (m) { parts.push('【KB · ' + m.entry.topic + '】\n' + (m.entry.answer || '')); if (m.second && m.second.topic) parts.push('【KB补充 · ' + m.second.topic + '】\n' + (m.second.answer || '')); }
  const ctx = corpusContext(q, subfield);
  if (ctx) parts.push('【语料库文献】\n' + ctx);
  parts.push('【实验关键参数】莫尔盐M=392.14g/mol | 产物M=491.25g/mol | 标准5.0g莫尔盐→理论6.26g | 氧化40℃ | 结晶水失重100℃ | 草酸pKa1=1.25 pKa2=4.27 | H2O2 φ°=+1.77V | Fe3+/Fe2+ φ°=+0.771V | [Fe(C2O4)3]3- lgKf≈20.2 | 高自旋d5 μeff≈5.92BM');
  return parts.join('\n\n---\n\n');
}

// ===== API 调用 =====
function callLLM(systemPrompt, userMessage, maxTokens = 600, temperature = 0.3, retries = 2, useFlash = false) {
  const model = useFlash ? CFG.modelFlash : CFG.model;
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const body = JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: maxTokens, temperature });
      const req = https.request(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY } }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(d);
            if (json.choices && json.choices[0]) resolve(json.choices[0].message.content);
            else if (json.error) {
              if (n < retries) { setTimeout(() => attempt(n + 1), 2000); }
              else reject(new Error('API error: ' + JSON.stringify(json.error)));
            } else reject(new Error('Unexpected: ' + d.slice(0, 200)));
          } catch (e) {
            if (n < retries) { setTimeout(() => attempt(n + 1), 2000); }
            else reject(new Error('Parse: ' + e.message));
          }
        });
      });
      req.on('error', e => { if (n < retries) setTimeout(() => attempt(n + 1), 2000); else reject(e); });
      req.setTimeout(180000, () => { req.destroy(); if (n < retries) setTimeout(() => attempt(n + 1), 2000); else reject(new Error('Timeout')); });
      req.write(body); req.end();
    };
    attempt(0);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== #1: Promise 并发池 =====
async function asyncPool(concurrency, items, fn) {
  const results = new Array(items.length); let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = { _error: e.message }; }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ===== #2: 断点续跑 checkpoint =====
const CHECKPOINT_FILE = path.join(BASE, '.pipeline_checkpoint.json');
function saveCheckpoint(data) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ ...data, savedAt: new Date().toISOString() }), 'utf8');
}
function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); } catch (e) { return null; }
}
function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch (e) { }
}

// ===== #3: 收敛检测 =====
function hasConverged(scoreHistory, threshold = 1.0, consecutiveRounds = 3) {
  if (scoreHistory.length < consecutiveRounds) return false;
  const recent = scoreHistory.slice(-consecutiveRounds);
  const vals = recent.map(r => r.avgScore);
  const range = Math.max(...vals) - Math.min(...vals);
  const noNewFaq = recent.every(r => (r.faqGrowth || 0) === 0);
  return range < threshold && noNewFaq;
}

// ===== #4: Jaccard 语义去重 =====
function jaccardSimilarity(a, b) {
  const ka = new Set((a.keys || []).map(k => norm(k)).filter(k => k.length >= 2 && !AMB.has(k)));
  const kb = new Set((b.keys || []).map(k => norm(k)).filter(k => k.length >= 2 && !AMB.has(k)));
  if (ka.size === 0 && kb.size === 0) return 0;
  let intersection = 0;
  for (const k of ka) { if (kb.has(k)) intersection++; }
  const union = ka.size + kb.size - intersection;
  return union > 0 ? intersection / union : 0;
}
function isDuplicateFAQ(newEntry, threshold = 0.6) {
  for (const existing of FAQ) {
    if (norm(existing.q) === norm(newEntry.q)) return true;
    if (norm(existing.title || '') === norm(newEntry.title || '')) return true;
    if (jaccardSimilarity(newEntry, existing) > threshold) return true;
  }
  return false;
}
// 全局缓存失效 — FAQ变更后调用
function invalidateFAQCache() { FAQ_INVERTED_IDX = null; }

// ===== #5: FAQ 倒排索引 =====
let FAQ_INVERTED_IDX = null;
function faqInvertedIndex() {
  if (FAQ_INVERTED_IDX) return FAQ_INVERTED_IDX;
  FAQ_INVERTED_IDX = new Map();
  FAQ.forEach((f, i) => {
    const allKeys = [...(f.keys || []), ...(f.ents || []), f.title || '', f.subfield || ''];
    allKeys.forEach(k => {
      const nk = norm(k);
      if (nk.length >= 2 && !AMB.has(nk)) {
        if (!FAQ_INVERTED_IDX.has(nk)) FAQ_INVERTED_IDX.set(nk, new Set());
        FAQ_INVERTED_IDX.get(nk).add(i);
      }
    });
  });
  return FAQ_INVERTED_IDX;
}
function matchFAQIndexed(q) {
  const nq = norm(q); const idx = faqInvertedIndex(); const scores = new Map();
  for (let i = 0; i < nq.length - 1; i++) {
    const bg = nq.slice(i, i + 2);
    if (AMB.has(bg)) continue;
    const ids = idx.get(bg);
    if (ids) { for (const id of ids) { scores.set(id, (scores.get(id) || 0) + 1); } }
  }
  for (const [key, ids] of idx) {
    if (key.length >= 3 && nq.includes(key)) {
      for (const id of ids) { scores.set(id, (scores.get(id) || 0) + 3); }
    }
  }
  if (scores.size === 0) return null;
  let best = null, bestScore = 0;
  for (const [id, sc] of scores) {
    if (sc > bestScore) { bestScore = sc; best = FAQ[id]; }
  }
  return bestScore >= 3 ? best : null;
}

// ===== #12: 清理旧输出文件 =====
function cleanupOldOutputs() {
  const files = fs.readdirSync(BASE);
  let cleaned = 0;
  for (const f of files) {
    if (/^test_questions_core_r\d+\.json$/.test(f) || /^structured_output_.*\.json$/.test(f)) {
      try { fs.unlinkSync(path.join(BASE, f)); cleaned++; } catch (e) { }
    }
  }
  if (cleaned > 0) console.log('  清理旧输出: ' + cleaned + ' 个文件');
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch (e) { }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (e2) {
      let fixed = m[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/\n/g, '\\n').replace(/\r/g, '');
      try { return JSON.parse(fixed); } catch (e3) { }
    }
  }
  return null;
}

// #8: 累积 Validator issues 用于反馈给 Trainer
let VALIDATOR_ISSUES = [];

// ===== 甲: Trainer =====
async function agentTrainer(cycleNum, prevScores) {
  console.log('\n' + '='.repeat(60));
  console.log('C' + cycleNum + ' 甲 (Trainer): 分析FAQ缺口...');

  const dist = {}; FAQ.forEach(e => { dist[e.subfield] = (dist[e.subfield] || 0) + 1; });
  const zeroCats = CATS.canonical.filter(c => !dist[c]);
  const thinCats = CATS.canonical.filter(c => dist[c] && dist[c] < 15);
  const allCatStatus = CATS.canonical.map(c => c + ':' + (dist[c] || 0) + '条').join(', ');

  const prevInfo = prevScores ? ('上轮均分:' + prevScores.avgScore + ' | 最弱分类:' + JSON.stringify(prevScores.weakCategories.slice(0, 5).map(c => c.category + '(' + c.avg + ')')) + ' | 分维均分: 准确性=' + (prevScores.dimAvg ? prevScores.dimAvg.accuracy : '?') + ' 完整性=' + (prevScores.dimAvg ? prevScores.dimAvg.completeness : '?') + ' 来源引用=' + (prevScores.dimAvg ? prevScores.dimAvg.source_usage : '?') + ' 清晰度=' + (prevScores.dimAvg ? prevScores.dimAvg.clarity : '?') + ' | 最低分题目:' + (prevScores.lowestQuestions || []).slice(0, 3).map(s => s.q.slice(0, 50) + '(' + s.score.total + ')').join(', ')) : '首轮';

  // #8: 汇总 Validator 发现的典型 issue
  const validatorFeedback = VALIDATOR_ISSUES.length > 0
    ? '\n【丁(Validator)反馈 — 上轮出题常见问题】\n' + VALIDATOR_ISSUES.slice(-15).map(v => '· 分类[' + v.category + '] Q:' + v.question + ' → ' + (v.issue || '') + (v.correction ? ' 修正:' + v.correction : '')).join('\n')
    : '';
  VALIDATOR_ISSUES = [];  // 消费后清空

  const prompt = '你是ChemAI FAQ训练师。分析FAQ并提出改进。\n\n' +
    '【FAQ总条目】' + FAQ.length + '\n' +
    '【各分类覆盖】' + allCatStatus + '\n' +
    '【0覆盖分类】' + (zeroCats.length > 0 ? zeroCats.join(', ') : '无') + '\n' +
    '【薄弱分类(<15条)】' + thinCats.join(', ') + '\n' +
    '【分类体系】' + JSON.stringify(CATS.canonical) + '\n' +
    '【上轮反馈】' + prevInfo + validatorFeedback + '\n\n' +
    '输出JSON（只输出JSON）：\n' +
    '{"analysis":"分析","gapCategories":["分类1"],"fixes":[\n' +
    '  {"action":"new_entry","q":"问题","answer":"答案(100-300字)","subfield":"分类名","title":"标题","detail":"细节(50-200字)","keys":["k1","k2","k3","k4","k5"],"ents":["e1","e2"]},\n' +
    '  {"action":"enrich_answer","q":"已有问题原文","new_value":"更完整答案"},\n' +
    '  {"action":"add_detail","q":"已有问题原文","new_value":"补充detail"},\n' +
    '  {"action":"add_keys","q":"已有问题原文","new_value":["新关键词"]}\n' +
    ']}';

  const result = await callLLM('你是FAQ训练师。只输出JSON。', prompt, 6000, 0.4, 2, false);
  const parsed = extractJSON(result);
  if (parsed && parsed.analysis) {
    console.log('  分析: ' + parsed.analysis);
    console.log('  缺口: ' + JSON.stringify(parsed.gapCategories || []));
    console.log('  修复: ' + (parsed.fixes || []).length + ' 条');
    return parsed;
  }
  console.log('  解析失败，使用默认');
  return { analysis: 'parse error', gapCategories: zeroCats.length > 0 ? zeroCats : thinCats.slice(0, 5), fixes: [] };
}

function applyFixes(fixes) {
  let applied = 0, newE = 0, enriched = 0, det = 0, keysAdd = 0;
  if (!Array.isArray(fixes)) return { applied: 0, newEntries: 0, enriched: 0, details: 0, keysAdded: 0 };

  fixes.forEach(fix => {
    if (!fix || !fix.action) return;
    if (fix.action === 'new_entry') {
      let newEntry;
      if (typeof fix.new_value === 'string') {
        try { newEntry = JSON.parse(fix.new_value); } catch (e) { }
      } else if (typeof fix.new_value === 'object') {
        newEntry = fix.new_value;
      }
      if (!newEntry && fix.q && fix.answer) {
        newEntry = { q: fix.q, answer: fix.answer, subfield: fix.subfield || '综合研究', title: fix.title || fix.q, keys: fix.keys || [], ents: fix.ents || [], detail: fix.detail || '' };
      }
      if (newEntry && newEntry.q && newEntry.answer && !isDuplicateFAQ(newEntry)) {
        let sf = newEntry.subfield || '综合研究';
        if (CATS.aliases[sf]) sf = CATS.aliases[sf];
        if (!CATS.canonical.includes(sf)) sf = '综合研究';
        FAQ.push({ q: newEntry.q, title: newEntry.title || newEntry.q, answer: newEntry.answer, subfield: sf, keys: (newEntry.keys || []).slice(0, 15), ents: (newEntry.ents || []).slice(0, 8), detail: newEntry.detail || '', knode: '' });
        invalidateFAQCache();
        applied++; newE++;
      }
    } else if (fix.action === 'enrich_answer') {
      const e = FAQ.find(e => e.q === fix.q); if (!e) return;
      if (fix.new_value && typeof fix.new_value === 'string' && fix.new_value.length > (e.answer || '').length) { e.answer = fix.new_value; applied++; enriched++; }
    } else if (fix.action === 'add_detail') {
      const e = FAQ.find(e => e.q === fix.q); if (!e) return;
      if (fix.new_value && typeof fix.new_value === 'string') { if (!e.detail || fix.new_value.length > e.detail.length) { e.detail = fix.new_value; applied++; det++; } }
    } else if (fix.action === 'add_keys') {
      const e = FAQ.find(e => e.q === fix.q); if (!e) return;
      if (Array.isArray(fix.new_value) && fix.new_value.length > 0) {
        const ex = new Set((e.keys || []).map(k => k.toLowerCase()));
        const toAdd = fix.new_value.filter(k => !ex.has(String(k).toLowerCase()));
        if (toAdd.length > 0) { e.keys = [...(e.keys || []), ...toAdd]; applied++; keysAdd++; }
      }
    }
  });
  return { applied, newEntries: newE, enriched, details: det, keysAdded: keysAdd };
}

// ===== 乙: Generator =====
async function agentGenerator(cycleNum, prevScores) {
  const categories = ACTIVE_CATS;
  console.log('\n' + '='.repeat(60));

  if (CFG.mode === 'single') {
    return await generatorWeighted(categories);
  }

  // #7: 自适应出题 — 弱分类多出题，强分类减量
  const basePerCat = Math.max(1, Math.floor(CFG.questionsPerCycle / categories.length));
  const perCatAlloc = {};
  if (prevScores && prevScores.weakCategories && prevScores.weakCategories.length > 0) {
    // 找最弱3个分类和最强3个分类
    const weakSet = new Set(prevScores.weakCategories.slice(0, 3).map(c => c.category));
    const strongSet = new Set(prevScores.weakCategories.slice(-3).map(c => c.category));
    let allocated = 0;
    categories.forEach(c => {
      if (weakSet.has(c)) perCatAlloc[c] = Math.round(basePerCat * 1.5);
      else if (strongSet.has(c) && !weakSet.has(c)) perCatAlloc[c] = Math.max(2, Math.round(basePerCat * 0.7));
      else perCatAlloc[c] = basePerCat;
      allocated += perCatAlloc[c];
    });
    // 调整使总量接近目标
    const target = categories.length * basePerCat;
    const diff = target - allocated;
    if (Math.abs(diff) > 0) {
      const adjustPerCat = Math.sign(diff) * Math.ceil(Math.abs(diff) / categories.length);
      categories.forEach(c => { perCatAlloc[c] = Math.max(2, perCatAlloc[c] + adjustPerCat); });
    }
  } else {
    categories.forEach(c => { perCatAlloc[c] = basePerCat; });
  }

  const totalTarget = Object.values(perCatAlloc).reduce((a, b) => a + b, 0);
  console.log('C' + cycleNum + ' 乙 (Generator): ' + categories.length + '分类, 目标' + totalTarget + '题' + (prevScores ? ' [自适应]' : ' [均衡]'));
  const weakInfo = prevScores ? ' 弱→强:' + prevScores.weakCategories.slice(0, 3).map(c => c.category + '×1.5').join(', ') : '';
  if (weakInfo) console.log('  ' + weakInfo);

  const allQ = [];
  for (let cIdx = 0; cIdx < categories.length; cIdx++) {
    const category = categories[cIdx];
    const manualRef = catManualRef(category);
    const catFAQs = FAQ.filter(e => e.subfield === category);
    const catFAQCount = catFAQs.length;
    const faqSamples = catFAQs.slice(0, 5).map(e => '· ' + (e.title || e.q).slice(0, 60) + ': ' + (e.answer || '').slice(0, 100)).join('\n');
    const mapping = CAT_CH_MAP[category] || { ch: [], focus: '' };

    const prompt = '你是ChemAI出题官。为三草酸合铁(III)酸钾制备实验的【' + category + '】分类生成' + n + '道精准题目。\n\n' +
      '【分类说明】' + (mapping.focus || '综合考察') + '\n' +
      '【FAQ已有】' + catFAQCount + '条 (样例):\n' + faqSamples + '\n' +
      '【手册参考】\n' + manualRef.slice(0, 1500) + '\n\n' +
      '要求：题目和答案必须能在FAQ样例和手册中找到依据，确保AI可以RAG检索回答。\n' +
      '【题型】填空(fill)×' + Math.max(1, Math.floor(n * 0.35)) + ', 简答(short)×' + Math.max(1, Math.floor(n * 0.35)) + ', 单选(single)×' + Math.max(1, Math.floor(n * 0.2)) + ', 计算(calculation)×' + Math.max(1, Math.floor(n * 0.1)) + '\n' +
      '【难度】基础×' + Math.ceil(n * 0.35) + ', 中等×' + Math.ceil(n * 0.45) + ', 较难×' + Math.floor(n * 0.2) + '\n' +
      '输出JSON数组（只输出JSON）：\n' +
      '[{"question":"题目","category":"' + category + '","type":"fill","difficulty":"基础","answer":"标准答案","explanation":"解析(含手册章节)"}]';

    let success = false;
    for (let att = 0; att < 3 && !success; att++) {
      try {
        const result = await callLLM('你是化学出题官。只输出JSON数组。', prompt, 8000, 0.5, 2, false);
        const parsed = extractJSON(result);
        if (parsed && Array.isArray(parsed) && parsed.length >= Math.floor(n * 0.5)) {
          parsed.forEach(q => { q._cycle = cycleNum; q._batch = cIdx + 1; if (!CATS.canonical.includes(q.category)) q.category = category; });
          allQ.push(...parsed);
          success = true;
          process.stdout.write('\r  [' + (cIdx + 1) + '/' + categories.length + '] ' + category + ': ' + parsed.length + '题  ');
        } else if (att < 2) await sleep(1000);
      } catch (e) { if (att < 2) await sleep(1000); }
    }
    if (!success) console.log('\n  ⚠ ' + category + ' 生成失败');
    await sleep(CFG.rateMs);
  }
  console.log('\n  总生成: ' + allQ.length + ' 题');
  return allQ;
}

// 加权分配模式 (200题)
async function generatorWeighted(categories) {
  const TARGET = CFG.questionsPerCycle;
  const dist = {}; FAQ.forEach(e => { dist[e.subfield] = (dist[e.subfield] || 0) + 1; });
  const weights = {}; let totalWeight = 0;
  categories.forEach(c => { const cnt = dist[c] || 1; weights[c] = Math.max(6, Math.round(30 - Math.log2(cnt + 1) * 5)); totalWeight += weights[c]; });
  const perCat = {}; let allocated = 0;
  categories.forEach(c => { perCat[c] = Math.max(6, Math.round(weights[c] / totalWeight * TARGET)); allocated += perCat[c]; });
  const diff = TARGET - allocated;
  const sortedCats = [...categories].sort((a, b) => (dist[a] || 0) - (dist[b] || 0));
  for (let i = 0; i < Math.abs(diff); i++) { const idx = i % sortedCats.length; perCat[sortedCats[idx]] += (diff > 0 ? 1 : -1); }

  console.log('乙 (Generator): 加权分配' + TARGET + '题');
  categories.forEach(c => console.log('  ' + c + ': FAQ=' + (dist[c] || 0) + ' → ' + perCat[c] + '题'));

  let allQ = []; let total = 0;
  for (const category of categories) {
    const n = perCat[category]; if (n <= 0) continue;
    const manualRef = catManualRef(category);
    const prompt = '你是ChemAI出题官。为三草酸合铁(III)酸钾制备实验的【' + category + '】分类生成' + n + '道精准题目。\n\n' +
      '【手册参考】\n' + manualRef.slice(0, 2000) + '\n\n' +
      '【题型】填空(fill)×' + Math.max(2, Math.floor(n * 0.3)) + ', 简答(short)×' + Math.max(2, Math.floor(n * 0.35)) + ', 单选(single)×' + Math.max(1, Math.floor(n * 0.25)) + ', 计算(calculation)×' + Math.max(1, Math.floor(n * 0.1)) + '\n' +
      '【难度】基础×' + Math.ceil(n * 0.35) + ', 中等×' + Math.ceil(n * 0.45) + ', 较难×' + Math.floor(n * 0.2) + '\n' +
      '输出JSON数组（只输出JSON）：\n' +
      '[{"question":"题目","category":"' + category + '","type":"fill","difficulty":"基础","answer":"标准答案","explanation":"解析(含章节号)"}]';

    let success = false;
    for (let att = 0; att < 3 && !success; att++) {
      try {
        const result = await callLLM('你是化学出题官。只输出JSON数组。', prompt, 8000, 0.5, 2, false);
        const parsed = extractJSON(result);
        if (parsed && Array.isArray(parsed) && parsed.length >= Math.floor(n * 0.6)) {
          parsed.forEach(q => { q._category = category; });
          allQ.push(...parsed);
          success = true; total += parsed.length;
          process.stdout.write('\r  [' + total + '/' + TARGET + '] ' + category + ': ' + parsed.length + '题');
        } else if (att < 2) await sleep(1500);
      } catch (e) { if (att < 2) await sleep(1500); }
    }
    if (!success) console.log('\n  ⚠ ' + category + ' 生成失败');
    await sleep(CFG.rateMs);
  }
  console.log('\n  总生成: ' + allQ.length + ' 题');
  return allQ.slice(0, TARGET);
}

// ===== 丁: Validator =====
async function agentValidator(cycleNum, questions) {
  console.log('\n' + '='.repeat(60));
  console.log('C' + cycleNum + ' 丁 (Validator): 校验 ' + questions.length + ' 题...');
  if (!questions.length) return [];

  const validations = []; const BATCH = 10;
  for (let i = 0; i < questions.length; i += BATCH) {
    const batch = questions.slice(i, i + BATCH);
    const qText = batch.map((q, j) => '[' + (j + 1) + '] ' + (q.category || q._category || '') + ' | Q:' + q.question + '\n   A:' + (q.answer || '').slice(0, 150)).join('\n\n');
    const batchCats = [...new Set(batch.map(q => q.category || q._category).filter(Boolean))];
    const refs = batchCats.map(c => catManualRef(c)).filter(Boolean).join('\n---\n').slice(0, 4000);

    try {
      const result = await callLLM('你是化学内容校验官。只输出JSON数组。',
        '【手册】\n' + refs + '\n\n【待校验】\n' + qText + '\n\n输出JSON：[{"index":题号,"valid":true/false,"issue":"问题或写无","correction":"修正或写无","manualRef":"手册章节"}]',
        5000, 0.2, 2, false);
      const parsed = extractJSON(result);
      if (parsed && Array.isArray(parsed)) {
        parsed.forEach(r => {
          if (r.index !== undefined && r.valid !== undefined) {
            const qi = i + parseInt(r.index) - 1;
            if (qi >= 0 && qi < questions.length) validations.push({ index: qi, question: questions[qi].question.slice(0, 80), category: questions[qi].category || questions[qi]._category, ...r });
          }
        });
      }
    } catch (e) { /* skip */ }
    await sleep(CFG.rateMs);
    process.stdout.write('\r  校验: ' + Math.min(i + BATCH, questions.length) + '/' + questions.length);
  }
  const vc = validations.filter(v => v.valid).length;
  const ic = validations.filter(v => !v.valid).length;
  // #8: 收集无效题目的 issue 供 Trainer 参考
  const invalidOnes = validations.filter(v => !v.valid);
  if (invalidOnes.length > 0) VALIDATOR_ISSUES.push(...invalidOnes);
  console.log('\n  有效:' + vc + ' | 有问题:' + ic + ' (' + (validations.length > 0 ? Math.round(vc / validations.length * 100) : 0) + '%)');
  return validations;
}

// ===== 丙: Scorer (#1: 并发评分 + #11: 6维化学专业性评分) =====

// #11: 评分锚定样例 (rubric anchors)
const RUBRIC_ANCHORS = {
  accuracy: '0=完全错误 | 10=方向对但多处错误 | 20=基本正确偶有小错 | 30=完全正确含精确数值/方程式',
  completeness: '0=未回答 | 7=覆盖部分要点 | 14=覆盖大部分 | 20=全面覆盖所有核心要点',
  chem_norm: '0=全是口语/无化学式 | 5=有化学式但缺上下标/单位 | 10=化学式基本规范 | 15=完美规范(Fe³⁺/Δ/H°/单位齐全)',
  source_usage: '0=无引用 | 5=模糊提及 | 10=至少1个明确引用 | 15=2+个精确引用DOI/语料#ID/FAQ标题',
  clarity: '0=混乱不可读 | 4=基本可读 | 7=清晰有条理 | 10=逻辑严密/分层/专业术语准确',
  safety: '0=完全未提及安全 | 3=笼统提及注意安全 | 7=提到具体风险 | 10=标注GHS/防护措施/应急处理'
};

async function scoreOneQuestion(q, i, t0) {
  const context = buildContext(q.question, q.category || q._category);
  let aiAnswer;
  try {
    aiAnswer = await callLLM(
      '你是ChemAI助手。基于下方参考材料回答化学问题。要求：1)优先使用FAQ和语料库中的事实和数据；2)引用来源标注[FAQ标题]或[语料#ID]；3)答案精确、包含关键数值和方程式；4)涉及危险试剂的回答必须包含安全提示；5)若参考材料无相关信息则回答「未命中」并给出你的最佳推测。',
      context + '\n\n【问题】' + q.question, 1000, 0.2, 2, false);
  } catch (e) { aiAnswer = '(ERROR)'; }

  const judgePrompt = '你是化学评分官。评分标准：语义正确即可给分，不要求与标准答案措辞一致。\n' +
    '【问题】' + q.question + '\n' +
    '【参考答案(非唯一标准)】' + (q.answer || '').slice(0, 250) + '\n' +
    '【AI回答】' + (aiAnswer || '').slice(0, 500) + '\n\n' +
    '评分维度(6维，满分100)：\n' +
    '1.a=事实准确性(0-30)：' + RUBRIC_ANCHORS.accuracy + '\n' +
    '2.c=完整性(0-20)：' + RUBRIC_ANCHORS.completeness + '\n' +
    '3.n=化学规范性(0-15)：' + RUBRIC_ANCHORS.chem_norm + '\n' +
    '4.s=来源引用(0-15)：' + RUBRIC_ANCHORS.source_usage + '\n' +
    '5.l=表述清晰度(0-10)：' + RUBRIC_ANCHORS.clarity + '\n' +
    '6.f=安全性提示(0-10)：' + RUBRIC_ANCHORS.safety + '\n\n' +
    '输出JSON：{"a":int,"c":int,"n":int,"s":int,"l":int,"f":int,"t":int,"brief":"评价"}';

  let score = { accuracy: 0, completeness: 0, chem_norm: 0, source_usage: 0, clarity: 0, safety: 0, total: 0, brief_comment: '' };
  try {
    const raw = await callLLM('你是评分官。只输出JSON。', judgePrompt, 600, 0.1, 2, false);
    const parsed = extractJSON(raw);
    if (parsed) {
      score.accuracy = Math.max(0, Math.min(30, parseInt(parsed.a || parsed.accuracy) || 0));
      score.completeness = Math.max(0, Math.min(20, parseInt(parsed.c || parsed.completeness) || 0));
      score.chem_norm = Math.max(0, Math.min(15, parseInt(parsed.n || parsed.chem_norm) || 0));
      score.source_usage = Math.max(0, Math.min(15, parseInt(parsed.s || parsed.source_usage) || 0));
      score.clarity = Math.max(0, Math.min(10, parseInt(parsed.l || parsed.clarity) || 0));
      score.safety = Math.max(0, Math.min(10, parseInt(parsed.f || parsed.safety) || 0));
      score.total = score.accuracy + score.completeness + score.chem_norm + score.source_usage + score.clarity + score.safety;
      score.brief_comment = String(parsed.brief || '');
    }
  } catch (e) { /* scoring error */ }

  const cat = q.category || q._category || '未分类';
  // checkpoint 进度日志
  if ((i + 1) % 10 === 0) {
    const elapsed = Math.floor((Date.now() - t0) / 1000);
    const done = i + 1;
    const eta = done < questions.length ? Math.floor(elapsed / done * (questions.length - done)) : 0;
    process.stdout.write('\r  [' + done + '/' + questions.length + '] ' + elapsed + 's | ETA ' + eta + 's');
    saveCheckpoint({ scoredCount: done, totalQuestions: questions.length, cycleNum: cycleNum });
  }

  return { index: i, question: q.question.slice(0, 60), category: cat, score, aiAnswer: (aiAnswer || '').slice(0, 150), _apiErr: aiAnswer === '(ERROR)' };
}

// 全局 cycleNum 引用供 scoreOneQuestion 使用
let cycleNum = 0;

async function agentScorer(_cycleNum, questions) {
  cycleNum = _cycleNum;
  console.log('\n' + '='.repeat(60));
  console.log('C' + cycleNum + ' 丙 (Scorer): RAG+LLM并发评分 ' + questions.length + ' 题 [并发×5]...');
  if (!questions.length) return { scores: [], avgScore: 0, catScores: {}, weakCategories: [], apiErrors: 0, elapsed: 0 };

  const t0 = Date.now();

  // #1: 用 Promise 并发池 (5路并发) 替代逐题串行
  const SCORE_CONCURRENCY = 5;
  const results = await asyncPool(SCORE_CONCURRENCY, questions, (q, i) => scoreOneQuestion(q, i, t0));
  // 在评分之间加入间隔
  // (asyncPool 内部已自动管理并发)

  const scores = results.filter(r => r && !r._error);
  const apiErrors = results.filter(r => r && (r._apiErr || r._error)).length;
  let totalScore = 0; const catScores = {};
  scores.forEach(s => {
    totalScore += s.score.total;
    const cat = s.category || '未分类';
    if (!catScores[cat]) catScores[cat] = { total: 0, count: 0 };
    catScores[cat].total += s.score.total; catScores[cat].count++;
  });

  const avgScore = parseFloat((totalScore / scores.length).toFixed(2));
  const weakCategories = Object.entries(catScores).map(([cat, d]) => ({ category: cat, avg: parseFloat((d.total / d.count).toFixed(1)), count: d.count })).sort((a, b) => a.avg - b.avg);
  const dimAvg = scores.length > 0 ? {
    accuracy: parseFloat((scores.reduce((s, x) => s + x.score.accuracy, 0) / scores.length).toFixed(1)),
    completeness: parseFloat((scores.reduce((s, x) => s + x.score.completeness, 0) / scores.length).toFixed(1)),
    chem_norm: parseFloat((scores.reduce((s, x) => s + x.score.chem_norm, 0) / scores.length).toFixed(1)),
    source_usage: parseFloat((scores.reduce((s, x) => s + x.score.source_usage, 0) / scores.length).toFixed(1)),
    clarity: parseFloat((scores.reduce((s, x) => s + x.score.clarity, 0) / scores.length).toFixed(1)),
    safety: parseFloat((scores.reduce((s, x) => s + x.score.safety, 0) / scores.length).toFixed(1))
  } : { accuracy: 0, completeness: 0, chem_norm: 0, source_usage: 0, clarity: 0, safety: 0 };
  const lowestQuestions = [...scores].sort((a, b) => a.score.total - b.score.total).slice(0, 5).map(s => ({ q: s.question, score: s.score, cat: s.category }));
  console.log('\n  均分:' + avgScore + ' | 分维: 准确' + dimAvg.accuracy + ' 完整' + dimAvg.completeness + ' 规范' + dimAvg.chem_norm + ' 引用' + dimAvg.source_usage + ' 清晰' + dimAvg.clarity + ' 安全' + dimAvg.safety);
  console.log('  最弱: ' + weakCategories.slice(0, 3).map(c => c.category + '(' + c.avg + ')').join(', '));
  return { scores, avgScore, catScores, weakCategories, dimAvg, lowestQuestions, apiErrors, elapsed: Math.floor((Date.now() - t0) / 1000) };
}

// ===== HTML 同步 =====
// DEPRECATED: kept for backward compat, no-op in v32
function syncFAQtoHTML() {
  console.log('\n=== FAQ → HTML 同步 ===');
  let html = fs.readFileSync(path.join(BASE, 'assistant.html'), 'utf8');
  const faqStart = html.indexOf('const FAQ=[');
  const commentMarker = '/* FAQ 匹配：多关键词命中率';
  const commentPos = html.indexOf(commentMarker, faqStart);
  if (faqStart < 0 || commentPos < 0) { console.log('  ✗ 找不到FAQ位置'); return; }
  const before = html.slice(Math.max(0, commentPos - 40), commentPos);
  const bm = before.match(/\];\s*$/);
  if (!bm) { console.log('  ✗ 找不到FAQ数组结束'); return; }

  const escLocal = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
  let faqJS = 'const FAQ=[\n'; let cnt = 0;
  FAQ.forEach(entry => {
    const keys = (entry.keys || []).filter(k => k && String(k).length >= 2).slice(0, 15);
    const ents = (entry.ents || []).filter(e => e && String(e).length >= 2).slice(0, 5);
    const title = entry.title || '', answer = (entry.answer || '').slice(0, 500), detail = (entry.detail || '').slice(0, 800);
    if (!title || !answer || answer.length < 10) return;
    if (!keys.length && !ents.length) return;
    faqJS += ' {keys:' + JSON.stringify(keys) + ',ents:' + JSON.stringify(ents) + ",title:'" + escLocal(title) + "',q:'" + escLocal(entry.q || title) + "',knode:'" + (entry.knode || '') + "',subfield:'" + escLocal(entry.subfield || '综合研究') + "',answer:'" + escLocal(answer) + "',detail:'" + escLocal(detail) + "'},\n";
    cnt++;
  });
  faqJS += '];\n/* FAQ 匹配：多关键词命中率 + 化学实体加权 */';
  const newHtml = html.slice(0, faqStart) + faqJS + html.slice(commentPos);
  fs.writeFileSync(path.join(BASE, 'assistant.html'), newHtml, 'utf8');
  console.log('  ✓ HTML已更新: ' + cnt + '条FAQ');
}

// ===== 总集报告更新 (#25: 仅保存摘要，完整数据写独立文件) =====
function updateMasterReport(runData) {
  const MASTER_PATH = path.join(BASE, 'Agent工作区/Agent-报告/reports_master.json');
  let master;
  if (fs.existsSync(MASTER_PATH)) {
    try { master = readJSON(MASTER_PATH); } catch (e) { master = { version: 'unified', runs: [] }; }
  } else {
    master = { version: 'unified', runs: [] };
  }

  const runName = CLI.mode + '-' + Date.now().toString(36);
  // #25: 只保存摘要（均分/分类分/弱项），完整数据写入带时间戳的独立文件
  const summary = {
    name: runName,
    description: CFG.description,
    generatedAt: new Date().toISOString(),
    totalDurationMin: runData.totalDurationMin,
    totalCycles: runData.totalCycles,
    initialFaqCount: runData.initialFaqCount,
    finalFaqCount: runData.finalFaqCount,
    faqGrowth: runData.faqGrowth,
    totalQuestionsGenerated: runData.totalQuestionsGenerated,
    finalDistribution: runData.finalDistribution,
    zeroCoverageAtEnd: runData.zeroCoverageAtEnd,
    scoreProgression: runData.scoreProgression,
    calibrationSummary: runData.corpusCalibration ? {
      totalCalibrated: runData.corpusCalibration.totalCalibrated,
      totalEnriched: runData.corpusCalibration.totalEnriched,
      totalCited: runData.corpusCalibration.totalCited
    } : null
  };
  master.runs.push(summary);

  master.summary = {
    totalRuns: master.runs.length,
    lastRun: runName,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2), 'utf8');

  // 完整评分细节写入独立时间戳文件
  const detailPath = path.join(BASE, 'reports_detail_' + runName + '.json');
  fs.writeFileSync(detailPath, JSON.stringify(runData, null, 2), 'utf8');

  console.log('  报告已写入总集: reports_master.json (' + runName + ')');
  console.log('  完整细节: reports_detail_' + runName + '.json');
}

// ===== 戊: Corpus Calibrator (语料库校准) =====
async function agentCorpusCalibrator() {
  console.log('\n' + '='.repeat(60));
  console.log('戊 (Corpus Calibrator): 遍历语料库校准FAQ答案...');
  console.log('语料库: ' + CORPUS.entries.length + '条 | FAQ: ' + FAQ.length + '条');

  // 为每条FAQ查找语料库匹配，分批进行校准
  const BATCH_SIZE = 15;
  let totalCalibrated = 0, totalEnriched = 0, totalCited = 0;
  const calibrations = [];

  // 按分类组织FAQ
  const faqByCat = {};
  FAQ.forEach((e, idx) => {
    const cat = e.subfield || '综合研究';
    if (!faqByCat[cat]) faqByCat[cat] = [];
    faqByCat[cat].push({ entry: e, index: idx });
  });

  for (const [cat, faqs] of Object.entries(faqByCat)) {
    console.log('\n--- ' + cat + ' (' + faqs.length + '条FAQ) ---');
    for (let i = 0; i < faqs.length; i += BATCH_SIZE) {
      const batch = faqs.slice(i, i + BATCH_SIZE);
      const batchText = batch.map((f, j) =>
        '[' + (j + 1) + '] Q:' + (f.entry.q || f.entry.title || '').slice(0, 100) +
        '\n    A:' + (f.entry.answer || '').slice(0, 200)
      ).join('\n\n');

      // 查找每个FAQ的语料库匹配
      const corpusRefs = [];
      batch.forEach(f => {
        const matches = bm25MatchCorpus(f.entry.q || f.entry.title || '', cat);
        if (matches.length > 0) {
          corpusRefs.push('FAQ[' + f.entry.q.slice(0, 60) + '] 匹配语料:');
          matches.forEach(m => {
            corpusRefs.push('  #' + m.en.id + ' ' + (m.en.title || '').slice(0, 100) +
              (m.en.doi ? ' DOI:' + m.en.doi : '') +
              (m.en.abstract ? '\n    摘要:' + m.en.abstract.slice(0, 300) : ''));
          });
        }
      });
      const corpusRefText = corpusRefs.join('\n');

      if (!corpusRefText) {
        process.stdout.write('\r  [' + Math.min(i + BATCH_SIZE, faqs.length) + '/' + faqs.length + '] ' + cat + ': 无匹配');
        await sleep(100);
        continue;
      }

      const prompt = '你是ChemAI语料库校准官。基于语料库文献校准FAQ答案。\n\n' +
        '【当前FAQ条目】\n' + batchText + '\n\n' +
        '【语料库匹配文献】\n' + corpusRefText.slice(0, 4000) + '\n\n' +
        '对每条FAQ判断是否需要校准。输出JSON数组（只输出JSON）：\n' +
        '[{"faqIndex":题号,"action":"calibrate/skip","reason":"校准原因或skip","enriched_answer":"更完整答案(含语料引用DOI/期刊)","add_detail":"补充细节","corpus_refs":["语料#ID: 引用说明"]}]';

      try {
        const result = await callLLM('你是语料库校准官。只输出JSON数组。', prompt, 8000, 0.3, 2, false);
        const parsed = extractJSON(result);
        if (parsed && Array.isArray(parsed)) {
          parsed.forEach(r => {
            if (!r || r.action === 'skip') return;
            const faqIdx = i + (parseInt(r.faqIndex) || 0) - 1;
            if (faqIdx < 0 || faqIdx >= faqs.length) return;
            const f = faqs[faqIdx];

            if (r.enriched_answer && r.enriched_answer.length > (f.entry.answer || '').length) {
              f.entry.answer = r.enriched_answer;
              totalEnriched++;
            }
            if (r.add_detail && r.add_detail.length > 0) {
              if (!f.entry.detail || r.add_detail.length > f.entry.detail.length) {
                f.entry.detail = r.add_detail;
              }
            }
            if (r.corpus_refs && r.corpus_refs.length > 0) {
              if (!f.entry.corpus_refs) f.entry.corpus_refs = [];
              r.corpus_refs.forEach(ref => {
                if (!f.entry.corpus_refs.includes(ref)) f.entry.corpus_refs.push(ref);
              });
              totalCited++;
            }
            totalCalibrated++;
            calibrations.push({
              q: f.entry.q.slice(0, 60),
              cat,
              reason: r.reason || '',
              corpusRefs: r.corpus_refs || []
            });
          });
        }
      } catch (e) { /* continue */ }
      await sleep(CFG.rateMs);
      process.stdout.write('\r  [' + Math.min(i + BATCH_SIZE, faqs.length) + '/' + faqs.length + '] ' + cat + ': 校准' + totalCalibrated);
    }
  }

  console.log('\n  校准完成: ' + totalCalibrated + '条 (丰富答案' + totalEnriched + ', 添加引用' + totalCited + ')');
  fs.writeFileSync(path.join(BASE, 'data', 'faq_unified.json'), JSON.stringify(FAQ, null, 2), 'utf8');
  return { totalCalibrated, totalEnriched, totalCited, calibrations: calibrations.slice(0, 20) };
}

// ===== MAIN =====
async function main() {
  const t0 = Date.now();

  // #12: 启动时清理旧输出文件
  cleanupOldOutputs();

  console.log('='.repeat(60));
  console.log('ChemAI 增强训练管线 (v4 + 语料库校准 + 并发 + 断点续跑 + 收敛检测)');
  console.log('FAQ:' + FAQ.length + ' | KB:' + KB.length + ' | 语料库:' + CORPUS.entries.length + ' | 分类:' + CATS.canonical.length + ' (活跃:' + ACTIVE_CATS.length + ')');
  console.log('模式: ' + CFG.description + ' | 周期: ' + CFG.cycles);
  console.log('='.repeat(60));

  // #2: 断点续跑 — 检查checkpoint (--no-resume跳过)
  const checkpoint = CLI.noResume ? null : loadCheckpoint();
  let startCycle = 1;
  let allCycles = [];
  let prevScores = null;
  let calibrationResult = null;
  let lastCorpusCalibrationRound = 0;
  const scoreHistory = [];

  if (checkpoint) {
    console.log('🔁 发现断点续跑文件 (C' + checkpoint.lastCompletedCycle + '完成) — 从C' + (checkpoint.lastCompletedCycle + 1) + '恢复');
    startCycle = checkpoint.lastCompletedCycle + 1;
    allCycles = checkpoint.allCycles || [];
    prevScores = checkpoint.prevScores || null;
    lastCorpusCalibrationRound = checkpoint.lastCorpusCalibrationRound || 0;
    if (checkpoint.scoreHistory) scoreHistory.push(...checkpoint.scoreHistory);
    calibrationResult = checkpoint.calibrationResult || null;
  }

  // === 阶段0: 语料库遍历校准（仅首轮无checkpoint时执行） ===
  if (!checkpoint) {
    console.log('\n' + '~'.repeat(60));
    console.log('阶段0: 语料库遍历校准 (291条文献 → ' + FAQ.length + '条FAQ)');
    console.log('~'.repeat(60));
    calibrationResult = await agentCorpusCalibrator();
    await sleep(CFG.rateMs * 2);
    saveCheckpoint({ lastCompletedCycle: 0, allCycles, prevScores, calibrationResult, scoreHistory, lastCorpusCalibrationRound: 0 });
  }

  // === 阶段1-N: 训练循环 ===
  for (let cycle = startCycle; cycle <= CFG.cycles; cycle++) {
    const cycleStart = Date.now();
    console.log('\n' + '#'.repeat(60));
    console.log('#### CYCLE ' + cycle + '/' + CFG.cycles + ' ####  [总运行' + Math.floor((Date.now() - t0) / 60000) + 'min]');
    console.log('#'.repeat(60));

    var training, questions;  // 声明在块顶部，供后续 cycleData 使用

    // #10: 甲(Trainer)和乙(Generator)在非首轮可并行
    if (cycle === 1 || !prevScores) {
      training = await agentTrainer(cycle, prevScores);
      const fixResult = applyFixes(training.fixes || []);
      console.log('  甲修复: ' + fixResult.applied + '条 (新' + fixResult.newEntries + ' 富' + fixResult.enriched + ' 详' + fixResult.details + ' 键' + fixResult.keysAdded + ')');
      fs.writeFileSync(path.join(BASE, 'data', 'faq_unified.json'), JSON.stringify(FAQ, null, 2), 'utf8');
      await sleep(CFG.rateMs);
      questions = await agentGenerator(cycle, prevScores);
    } else {
      const [tResult, qResult] = await Promise.all([
        agentTrainer(cycle, prevScores),
        agentGenerator(cycle, prevScores)
      ]);
      training = tResult;
      questions = qResult;
      const fixResult = applyFixes(training.fixes || []);
      console.log('  甲修复: ' + fixResult.applied + '条 (新' + fixResult.newEntries + ' 富' + fixResult.enriched + ' 详' + fixResult.details + ' 键' + fixResult.keysAdded + ')');
      fs.writeFileSync(path.join(BASE, 'data', 'faq_unified.json'), JSON.stringify(FAQ, null, 2), 'utf8');
    }
    await sleep(CFG.rateMs);

    // 丁: Validator
    const validations = await agentValidator(cycle, questions);
    await sleep(CFG.rateMs);

    // 丙: Scorer (并发评分)
    const scoreResult = await agentScorer(cycle, questions);
    prevScores = scoreResult;

    // #3: 收敛检测
    const dist = {}; FAQ.forEach(e => { dist[e.subfield] = (dist[e.subfield] || 0) + 1; });
    const faqGrowth = FAQ.length - INITIAL_FAQ;
    scoreHistory.push({ avgScore: scoreResult.avgScore, faqGrowth: faqGrowth - (scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1].faqGrowth : faqGrowth) });
    if (scoreHistory.length > 20) scoreHistory.shift();  // 保留最近20轮

    // 周期数据
    const cycleData = {
      cycle, timestamp: new Date().toISOString(), cycleDurationMin: Math.floor((Date.now() - cycleStart) / 60000),
      training: { analysis: (typeof training !== 'undefined' ? training : {}).analysis || '', gapCategories: (typeof training !== 'undefined' ? training : {}).gapCategories || [] },
      generation: { questionCount: questions.length, categoriesCovered: [...new Set(questions.map(q => q.category || q._category))] },
      validation: { total: validations.length, valid: validations.filter(v => v.valid).length, invalid: validations.filter(v => !v.valid).length },
      scoring: { avgScore: scoreResult.avgScore, weakCategories: scoreResult.weakCategories.slice(0, 5), apiErrors: scoreResult.apiErrors, elapsed: scoreResult.elapsed },
      faqCount: FAQ.length, faqGrowth, faqDistribution: dist, zeroCoverageCats: CATS.canonical.filter(c => !dist[c])
    };
    allCycles.push(cycleData);

    // #2: 周期结束后保存checkpoint
    saveCheckpoint({
      lastCompletedCycle: cycle, allCycles, prevScores, calibrationResult, scoreHistory, lastCorpusCalibrationRound
    });

    const zeroCats = CATS.canonical.filter(c => !dist[c]);
    const converged = hasConverged(scoreHistory);
    console.log('\n  C' + cycle + ' 完成 [' + cycleData.cycleDurationMin + 'min]: FAQ=' + FAQ.length + ' (+' + (FAQ.length - INITIAL_FAQ) + ') Qs=' + questions.length + ' 分数=' + scoreResult.avgScore + (zeroCats.length > 0 ? ' ⚠0覆盖:' + zeroCats.join(',') : ' ✓') + (converged ? ' 🎯收敛!' : ''));

    // #3: 收敛 → 提前终止
    if (converged) {
      console.log('\n  ⚡ 分数已收敛 (连续3轮波动<1分且无新FAQ) — 提前终止于C' + cycle);
      break;
    }

    // #6: 增量语料库校准 — 每5轮或FAQ净增>20条时触发
    const faqNetGrowth = FAQ.length - INITIAL_FAQ;
    const roundsSinceLastCalib = cycle - lastCorpusCalibrationRound;
    if (roundsSinceLastCalib >= 5 || faqNetGrowth - (lastCorpusCalibrationRound === 0 ? 0 : allCycles[lastCorpusCalibrationRound - 1]?.faqCount || 0) > 20) {
      console.log('\n  🔄 增量语料库校准 (距上次校准' + roundsSinceLastCalib + '轮, FAQ净增' + faqNetGrowth + ')');
      await agentCorpusCalibrator();
      lastCorpusCalibrationRound = cycle;
      saveCheckpoint({ lastCompletedCycle: cycle, allCycles, prevScores, calibrationResult, scoreHistory, lastCorpusCalibrationRound });
    }
  }

  // 完成 → 清理checkpoint
  clearCheckpoint();

  // 最终报告
  const totalMin = Math.floor((Date.now() - t0) / 60000);
  const finalDist = {}; FAQ.forEach(e => { finalDist[e.subfield] = (finalDist[e.subfield] || 0) + 1; });

  const finalReport = {
    version: CLI.mode,
    generatedAt: new Date().toISOString(),
    totalDurationMin: totalMin,
    totalCycles: allCycles.length,
    initialFaqCount: INITIAL_FAQ,
    finalFaqCount: FAQ.length,
    faqGrowth: FAQ.length - INITIAL_FAQ,
    corpusCalibration: calibrationResult,
    totalQuestionsGenerated: allCycles.reduce((s, c) => s + (c.generation ? c.generation.questionCount : 0), 0),
    finalDistribution: finalDist,
    zeroCoverageAtEnd: CATS.canonical.filter(c => !finalDist[c]),
    scoreProgression: allCycles.map(c => ({ cycle: c.cycle, avgScore: c.scoring ? c.scoring.avgScore : 0, faqCount: c.faqCount || 0 })),
    cycles: allCycles
  };

  // 写入总集
  updateMasterReport(finalReport);

  // 保存FAQ
  fs.writeFileSync(path.join(BASE, 'data', 'faq_unified.json'), JSON.stringify(FAQ, null, 2), 'utf8');

  // HTML同步
  if (CLI.syncHtml) syncFAQtoHTML();

  console.log('\n' + '='.repeat(60));
  console.log('管线完成! 总耗时: ' + totalMin + 'min');
  if (calibrationResult) console.log('语料库校准: ' + calibrationResult.totalCalibrated + '条 (丰富' + calibrationResult.totalEnriched + ', 引用' + calibrationResult.totalCited + ')');
  console.log('FAQ: ' + INITIAL_FAQ + ' → ' + FAQ.length + ' (+' + (FAQ.length - INITIAL_FAQ) + ')');
  console.log('分数趋势: ' + allCycles.map(c => 'C' + c.cycle + ':' + (c.scoring ? c.scoring.avgScore : '?')).join(' → '));
  const finalZero = CATS.canonical.filter(c => !finalDist[c]);
  if (finalZero.length > 0) console.log('⚠ 仍有0覆盖分类: ' + finalZero.join(', '));
  else console.log('✓ 全部' + CATS.canonical.length + '个分类已覆盖!');
}

main().catch(e => { console.error('FATAL: ' + e.message + '\n' + e.stack); process.exit(1); });
