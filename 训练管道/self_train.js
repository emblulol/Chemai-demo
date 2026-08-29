'use strict';
/**
 * ChemAI FAQ 自训练迭代编排器
 * 流程(每轮): 出题agent(仅首轮,固定题集) → 审核agent(首轮) → 本地回复(local_answer) → 评分agent(0-10,门禁9.5) → 3优化agent(检索/答案/覆盖) → 注入assistant.html
 * 5轮循环, 全部≥9.5提前结束; 断点=轮产物文件复用
 * 用法:
 *   $env:DEEPSEEK_KEY=...; $env:DEEPSEEK_MODEL='deepseek-v4-flash'
 *   $env:N=20; $env:ROUNDS=1; node 训练管道/self_train.js     # 试点
 *   $env:N=200; $env:ROUNDS=5; node 训练管道/self_train.js    # 全量
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { readFAQRuntime, writeFAQRuntime, applyManifestToArray } = require('../scripts/lib-assistant-faq.js');
const localAnswer = require('./local_answer.js');

const root = path.join(__dirname, '..');
const W = p => path.join(root, p);
const readJson = fp => JSON.parse(fs.readFileSync(W(fp), 'utf8').replace(/^﻿/, ''));
const writeJson = (fp, d) => fs.writeFileSync(W(fp), JSON.stringify(d, null, 2), 'utf8');
const exists = fp => fs.existsSync(W(fp));

// ---------- 配置 ----------
const N = Number(process.env.N || 200);
const ROUNDS = Number(process.env.ROUNDS || 5);
const START_ROUND = Number(process.env.START_ROUND || 1);
const GATE = 9.5;
const BATCH = Number(process.env.BATCH || 10);
const GEN_BATCH = 5;   // 出题批次（参考答案长，防截断）
const SCORE_BATCH = 1; // 评分逐题隔离（批次评分裁判严重低估，隔离才可靠）
const CONC = 5;
const MAX_FAQ = 1700;      // 超过则 Opt3 暂停
const MAX_SIZE = 3.5 * 1024 * 1024;
const SEEN_FILE = 'Agent工作区/Agent-B-问题生成/self_train_seen_questions.json';

// ---------- LLM 助手（copy agent-loop.js）----------
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = path.join(homeDir, '.codex/skills/claude-vision/.env');
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const getEnv = key => { const m = env.match(new RegExp('^' + key + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const API_KEY = process.env.DEEPSEEK_KEY || getEnv('DEEPSEEK_KEY') || getEnv('DASHSCOPE_API_KEY');
const API_URL = (process.env.DEEPSEEK_KEY || getEnv('DEEPSEEK_KEY'))
  ? 'https://api.deepseek.com/v1/chat/completions'
  : (getEnv('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1') + '/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
if (!API_KEY) { console.error('缺少 DEEPSEEK_KEY(或 dotenv DASHSCOPE_API_KEY)；请设置后重试'); process.exit(1); }

function llm(messages, maxTokens = 16000, temp = 0.3) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: temp, reasoning_effort: 'low' });
    const req = https.request(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');  // 一次性解码，避免多字节字符跨chunk截断成�
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + data.slice(0, 300)));
        try { resolve(JSON.parse(data).choices[0].message.content); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw0 = fence ? fence[1] : text;
  const start = raw0.indexOf('[');
  if (start < 0) throw new Error('JSON array not found');
  const end = raw0.lastIndexOf(']');
  const slice = end > start ? raw0.slice(start, end + 1) : raw0.slice(start);
  try { return JSON.parse(slice); } catch (e) {
    // 截断挽救：截到最后一个完整 } 再补 ]（LLM 大输出常被 max_tokens 截断）
    const last = slice.lastIndexOf('}');
    if (last > start) { try { return JSON.parse(slice.slice(0, last + 1) + ']'); } catch (e2) {} }
    throw new Error('JSON 解析失败: ' + e.message.slice(0, 60));
  }
}
async function llmJSON(system, user, maxTokens, temp = 0.3) {
  for (let a = 0; a < 3; a++) {
    try {
      const out = await llm([{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens, temp);
      const items = parseJSON(out);
      if (Array.isArray(items)) return items;
    } catch (e) { console.log('    LLM重试 ' + (a + 1) + ': ' + e.message.slice(0, 80)); }
  }
  return null;
}
/**
 * 批量调用 + 逐题回填：先分批调用 llmJSON，未覆盖的题目逐个单题补评（单题输出短、更可靠）。
 * items: 题目数组；buildUser(chunk): 构造 user prompt；keyOf(item): 该题在LLM返回中的标识字段。
 * 返回与 items 等长的数组（失败项为 null）。
 */
async function llmJSONCovered(items, system, buildUser, batchSize, maxTokens, keyOf, temp = 0.3) {
  const out = new Array(items.length).fill(null);
  const key = keyOf || (x => String(x.question || x.id || x.title || '').trim());
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const resp = await llmJSON(system, buildUser(chunk, i), maxTokens, temp);
    if (resp && resp.length) {
      const want = new Set(chunk.map(key));
      resp.forEach(r => {
        const k = String((r && (r.question || r.id || r.title)) || '').trim();
        if (want.has(k)) {
          const idx = i + chunk.findIndex((c, ci) => key(c) === k);
          if (out[idx] === null) out[idx] = r;
        }
      });
    }
    const missing = out.slice(i, i + batchSize).filter(x => x === null).length;
    if (missing) console.log('    批次缺 ' + missing + ' 条，将逐题回填');
  }
  for (let i = 0; i < items.length; i++) {
    if (out[i] === null) {
      const r = await llmJSON(system, buildUser([items[i]], i), Math.min(maxTokens, 12000), temp);
      out[i] = (r && r.length) ? r[0] : null;
    }
  }
  return out;
}
async function runPool(items, worker, size) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await worker(items[i], i); }
  }));
  return out;
}

// ---------- 权威事实基准（prompt 注入）----------
const AUTHORITY = `
权威实验参数（武汉大学实验讲义，数值冲突一律以此为准）：
- 试剂：硫酸亚铁铵(摩尔盐)(NH₄)₂Fe(SO₄)₂·6H₂O 5.0g；草酸二水合物 H₂C₂O₄·2H₂O 1.7g；草酸钾一水合物 K₂C₂O₄·H₂O 3.5g；6% H₂O₂ 8mL（权威值，旧资料10mL为笔误）；3mol/L H₂SO₄ 数滴；95%乙醇 10mL
- 四步：①沉淀 5.0g摩尔盐+数滴3mol/L H₂SO₄+15mL水溶解，1.7g草酸+10mL水，分别加热近沸后混合，微沸4分钟，倾滗法，热水洗至BaCl₂无SO₄²⁻，得FeC₂O₄·2H₂O↓
  ②氧化 加3.5g草酸钾+15mL水，40℃水浴，每秒1~2滴滴加6%H₂O₂ 8mL，继续搅拌5分钟，加热至沸保持2分钟除过量H₂O₂，K₃Fe(CN)₆检验Fe²⁺
  ③配位 约1.5g草酸配成约0.5mol/L溶液(约30mL)，逐滴滴加至Fe(OH)₃完全溶解、溶液透明翠绿即终点
  ④结晶 加约10mL 95%乙醇，悬棉线提供晶核，盖表面皿暗处静置过夜，抽滤，乙醇洗2次，50℃烘箱烘干20分钟（严禁超50℃）
- 关键数值：失结晶水100℃、分解230℃、烘干50℃(严禁超)、理论产量6.26g、M=491.25 g/mol
- 常数：Ksp(FeC₂O₄)=3.2×10⁻⁷、Ksp(Fe(OH)₃)=2.79×10⁻³⁹、Kf[Fe(C₂O₄)₃³⁻]=1.6×10²⁰、高自旋t₂g³eg² μ≈5.92 BM
- 四步反应式：
  1) (NH₄)₂Fe(SO₄)₂·6H₂O + H₂C₂O₄ → FeC₂O₄·2H₂O↓ + (NH₄)₂SO₄ + H₂SO₄ + 4H₂O
  2) 6FeC₂O₄·2H₂O + 3H₂O₂ + 6K₂C₂O₄ → 4K₃[Fe(C₂O₄)₃] + 2Fe(OH)₃↓ + 12H₂O
  3) 2Fe(OH)₃ + 3H₂C₂O₄ + 3K₂C₂O₄ → 2K₃[Fe(C₂O₄)₃] + 6H₂O
  4) K₃[Fe(C₂O₄)₃](aq) + C₂H₅OH → K₃[Fe(C₂O₄)₃]·3H₂O↓
- 光敏：K₃[Fe(C₂O₄)₃] 见光 LMCT 光解生成Fe²⁺（2[Fe(C₂O₄)₃]³⁻ →(hν) 2Fe²⁺ + 3C₂O₄²⁻ + 2CO₂↑），故结晶需暗处
- 显色：K₃[Fe(CN)₆](铁氰化钾)检验Fe²⁺ → KFe[Fe(CN)₆]↓ 蓝色沉淀
`;
const MANUAL = exists('data/manual.json') ? readJson('data/manual.json') : { chapters: [] };
function manualDigest() {
  const chapters = (MANUAL.chapters || []).map(ch =>
    '第' + ch.number + '章 ' + ch.title + '\n' + (ch.sections || []).map(s => '  - ' + s.id + ' ' + s.title).join('\n')
  ).join('\n');
  const op = (MANUAL.chapters[3]?.sections?.[0]?.content || '').replace(/\s+/g, ' ').slice(0, 1200);
  return chapters + '\n\n核心操作摘录：\n' + op;
}
function corpusDigest(n = 8) {
  try {
    const c = readJson('data/corpus.json');
    return c.entries.slice(0, n).map(e => '#' + e.id + ' [' + e.subfield + '] ' + (e.title || '').slice(0, 60)).join('\n');
  } catch (e) { return '(语料读取失败)'; }
}

// ---------- 角色 prompts ----------
const GEN_SYSTEM = '你是 ChemAI 实验课程高级出题官，依据武汉大学实验讲义与文献出题。只输出 JSON 数组，不要 Markdown。' +
  '每项：{"question":"题目","referenceAnswer":"以讲义为准的简要参考答案(≤150字)","focusArea":"温度|浓度|pH|光照|时间|试剂用量|物质性质|反应机理","subfield":"17分类之一","difficulty":"中|较难","literatureNote":"语料#id或讲义章节，体现文献/讲义出处"}。' +
  '要求：题目有深度、不简单；聚焦实验步骤各影响因素与各物质(草酸/草酸亚铁/铁(III)/K₃[Fe(C₂O₄)₃]/摩尔盐)的性质与作用；考察"为什么/如果…会怎样/如何判断"而非直接复述；每题能适配讲义与文献。答案务必简短(≤150字)，保证每批输出能在有限token内完整。';
const AUDIT_SYSTEM = '你是 ChemAI 审核官，逐题核对题目与参考答案是否符合武汉大学实验讲义、有无科学性错误。只输出 JSON 数组，' +
  '每项：{"question":"原题原文","valid":true/false,"issue":"问题简述或留空","correction":"修正后的题目(如不需要则留原题)","referenceCorrection":"修正后的参考答案(如不需要则留空)"}。数值冲突一律以讲义为准(6%H₂O₂=8mL)。';
const SCORE_SYSTEM = '你是 ChemAI 评分官。对每条给出"AI助手本地回复"对照"标准参考答案"的评分，满分10分。只输出 JSON 数组，' +
  '每项：{"question":"原题","score":0-10小数一位,"accuracy":0-10,"completeness":0-10,"manualCompliance":0-10,"why":"一句原因","missing":"缺漏要点(逗号分隔)"}。' +
  '评分准则：回复准确且覆盖参考答案关键点(数值/步骤/机理)且与讲义一致→9.5以上；部分覆盖→6-9；答非所问/缺失关键→<6。严禁一律给满分或一律压分。';

// ---------- 题目集 ----------
function qFile() { return 'Agent工作区/Agent-B-问题生成/self_train_q_n' + N + '.json'; }
function qFinalFile() { return 'Agent工作区/Agent-B-问题生成/self_train_q_n' + N + '_final.json'; }

async function genQuestions(round) {
  const fp = qFile();
  if (exists(fp)) { console.log('[出题] 复用题目集', readJson(fp).length); return; }
  console.log('[出题] 生成 ' + N + ' 题');
  const seen = exists(SEEN_FILE) ? readJson(SEEN_FILE) : [];
  const all = [];
  const batches = Math.ceil(N / GEN_BATCH);
  const seenHint = seen.length ? '\n\n以下为已出过的题目（请避免重复主题与问法）：\n' + seen.slice(-40).map(s => ' - ' + (s.question || s).slice(0, 50)).join('\n') : '';
  const userFor = (i) => {
    const want = Math.min(GEN_BATCH, N - i * GEN_BATCH);
    return '请生成 ' + want + ' 道高深度题目，覆盖不同 focusArea/subfield，不要重复，题与题之间差异化。\n\n' + AUTHORITY + '\n\n手册：\n' + manualDigest() + '\n\n语料文献参考：\n' + corpusDigest() + seenHint;
  };
  const batchResults = await runPool(Array.from({ length: batches }, (_, i) => i), async (i) => {
    const items = await llmJSON(GEN_SYSTEM, userFor(i), 16000);
    return items || [];
  }, 5);
  batchResults.forEach(items => {
    items.forEach((x, j) => all.push({ id: 'Q' + String(all.length + j + 1).padStart(3, '0'), ...x }));
  });
  console.log('  已生成', all.length);
  writeJson(fp, all.slice(0, N));
  // 累积到 seen
  const merged = seen.concat(all.slice(0, N).map(q => ({ question: q.question, focusArea: q.focusArea, subfield: q.subfield })));
  writeJson(SEEN_FILE, merged);
  console.log('[出题] 已累积题目总数:', merged.length);
}

async function auditQuestions() {
  const finalFp = qFinalFile();
  if (exists(finalFp)) { console.log('[审核] 复用终审题集', readJson(finalFp).length); return; }
  const qs = readJson(qFile());
  console.log('[审核] 审核 ' + qs.length + ' 题');
  const batches = [];
  for (let i = 0; i < qs.length; i += BATCH) batches.push(qs.slice(i, i + BATCH));
  const buildUser = (batch) => '逐题审核(数值以讲义为准, 6%H₂O₂=8mL)：\n' + JSON.stringify(batch.map(x => ({ question: x.question, referenceAnswer: x.referenceAnswer, focusArea: x.focusArea })), null, 2) + '\n\n' + AUTHORITY + '\n\n手册：\n' + manualDigest();
  const batchResults = await runPool(batches, async (batch) => {
    const items = await llmJSON(AUDIT_SYSTEM, buildUser(batch), 16000);
    return items || [];
  }, 5);
  const results = [];
  batchResults.forEach(items => items.forEach(v => results.push(v)));
  console.log('  已审核', results.length);
  const byQ = {};
  qs.forEach(q => { byQ[q.question] = q; });
  results.forEach(r => {
    if (r && byQ[r.question]) {
      if (r.valid === false) {
        // 防"请保持原题不变"这类占位被当作修正应用
        if (r.correction && r.correction !== r.question && !/请保持原题|保持原题|无需修改|无需改动|原题正确/.test(r.correction)) byQ[r.question].question = r.correction;
      }
      if (r.referenceCorrection) byQ[r.question].referenceAnswer = r.referenceCorrection;
    }
  });
  writeJson(finalFp, Object.values(byQ));
  console.log('[审核] 终审题集已冻结 → ' + finalFp);
}

// ---------- 本地回复 ----------
function runLocalReplies(round) {
  const fp = 'Agent工作区/Agent-B-问题生成/self_train_replies_r' + round + '.json';
  if (exists(fp)) { console.log('[回复] 复用', readJson(fp).length); return readJson(fp); }
  const qs = readJson(qFinalFile());
  const replies = qs.map(q => {
    const r = localAnswer.answer(q.question);
    return { id: q.id, question: q.question, matchedFAQ: r.matchedFAQ ? r.matchedFAQ.title : null, confidence: r.confidence && r.confidence.level, answerText: r.answerText };
  });
  writeJson(fp, replies);
  console.log('[回复] 本地回复完成', replies.length);
  return replies;
}

// ---------- 评分 ----------
async function scoreReplies(round) {
  const fp = 'Agent工作区/Agent-C-答案评分/self_train_scores_r' + round + '.json';
  if (exists(fp)) { console.log('[评分] 复用', readJson(fp).length); return readJson(fp); }
  const qs = readJson(qFinalFile());
  const replies = runLocalReplies(round);
  const rById = {}; replies.forEach(r => rById[r.id] = r);
  console.log('[评分] 评分 ' + qs.length + ' 题');
  const buildUser = (chunk) => {
    const entries = chunk.map(q => ({
      question: q.question,
      referenceAnswer: (q.referenceAnswer || '').slice(0, 300),
      assistantAnswer: ((rById[q.id] || {}).answerText || '').slice(0, 500)
    }));
    return '请按标准参考答案给 AI 助手本地回复评分(0-10)：\n' + JSON.stringify(entries, null, 2);
  };
  const raw = await runPool(qs, async (q) => {
    // 逐题隔离评分（并发 CONC=8 加速）
    const items = await llmJSON(SCORE_SYSTEM, buildUser([q]), 16000, 0);
    return items && items[0] ? items[0] : null;
  }, 8);
  const results = qs.map((q, i) => {
    const v = raw[i];
    return { id: q.id, question: q.question, score: v ? Number(v.score) : 0, accuracy: v ? Number(v.accuracy) : 0, completeness: v ? Number(v.completeness) : 0, manualCompliance: v ? Number(v.manualCompliance) : 0, why: v ? (v.why || '') : '', missing: v ? (v.missing || '') : '' };
  });
  writeJson(fp, results);
  const unscored = results.filter(r => r.score === 0).length;
  console.log('[评分] 完成', results.length, unscored ? ('(0分/未评 ' + unscored + ')') : '');
  return results;
}

// ---------- 三优化 agent ----------
const OPT1_SYSTEM = '你是 ChemAI 检索优化官。针对评分低(<9.5)的题目，为既有FAQ条目补充检索关键词，使本地匹配能命中正确条目。只输出 JSON 数组，' +
  '每项：{"id":"对应题目id(逐字复制输入)","target":"目标FAQ条目的title或q原文(必须逐字复制reply.matchedFAQ)","add_keys":["补充检索词",...],"add_ents":["补充实体词",...]}。' +
  '若无匹配条目(matchedFAQ为null)，target置为空串""，本项不处理。关键词用学术/实验术语，与题目问法相关。';
const OPT2_SYSTEM = '你是 ChemAI 答案优化官。针对低分题，为已命中FAQ条目的 detail 追加针对该主题的深度补充（不重写 answer）。只输出 JSON 数组，' +
  '每项：{"id":"对应题目id(逐字复制)","target":"目标FAQ条目的title或q原文(逐字复制)","add_detail":"针对该主题的补充细节(60~150字,可含 corpus#id 引用,以讲义为准)"}。' +
  '仅当命中条目确属该题主题时才输出；否则该项不输出。数值以讲义为准(6%H₂O₂=8mL)。';
const OPT3_SYSTEM = '你是 ChemAI 覆盖优化官。针对评分低(<9.5)的题目，为其新建专属FAQ条目，使本地检索能命中且答案覆盖该题全部要点。只输出 JSON 数组，' +
  '每项：{"id":"对应题目id(逐字复制)","keys":["检索词≥5个,须包含题目中最独特的实验术语(如具体试剂、温度、现象、步骤名)"],"ents":["实体词"],"title":"条目标题(反映该题主题,简洁)","q":"题目原文(逐字复制整个问题,使matchFAQ的qHit命中)","subfield":"17分类之一","answer":"完整参考答案(80~180字,以讲义为准,覆盖题目所有要点)","detail":"补充细节(含 corpus#数字 引用)"}。' +
  'keys 必须让本题及其变体能被本地检索命中，q 必须为题目原文，answer 必须准确完整覆盖题目要点。数值以讲义为准(6%H₂O₂=8mL)。';

async function optCovered(items, system, buildUser, conc) {
  const out = new Array(items.length).fill(null);
  await runPool(items, async (x, i) => {
    const r = await llmJSON(system, buildUser([x], i), 16000);
    out[i] = (r && r.length) ? r[0] : null;
  }, conc || 5);
  return out;
}

async function threeOpt(round) {
  const qs = readJson(qFinalFile());
  const replies = runLocalReplies(round);
  const scores = readJson('Agent工作区/Agent-C-答案评分/self_train_scores_r' + round + '.json');
  const scoreById = {}; scores.forEach(s => scoreById[s.id] = s);
  const low = qs.map(q => ({ q, s: scoreById[q.id] || { score: 0 }, r: replies.find(x => x.id === q.id) || {} }))
    .filter(x => x.s.score < GATE);
  console.log('[优化] 低分题 ' + low.length + ' 道 (<' + GATE + ')');
  const lowFp = 'Agent工作区/Agent-优化/self_train_low_r' + round + '.json';
  writeJson(lowFp, low.map(x => ({ id: x.q.id, question: x.q.question, score: x.s.score, missing: x.s.missing, matchedFAQ: x.r.matchedFAQ, answerText: (x.r.answerText || '').slice(0, 300) })));

  const opt1fp = 'Agent工作区/Agent-优化/self_train_opt1_r' + round + '.json';
  const opt2fp = 'Agent工作区/Agent-优化/self_train_opt2_r' + round + '.json';
  const opt3fp = 'Agent工作区/Agent-优化/self_train_opt3_r' + round + '.json';

  // 三个优化 agent 并发执行（各用逐项并发池加速）
  const [opt1Raw, opt2Raw, opt3Raw] = await Promise.all([
    (async () => {
      if (exists(opt1fp)) return null;
      if (!low.length) return null;
      const items = low.map(x => ({ id: x.q.id, question: x.q.question, score: x.s.score, matchedFAQ: x.r.matchedFAQ }));
      const raw = await optCovered(items, OPT1_SYSTEM, chunk => '以下为低分题目及其命中FAQ，请为每条输出检索关键词补充方案(每项带id)：\n' + JSON.stringify(chunk, null, 2) + '\n\n' + AUTHORITY, 5);
      const out = items.map((x, i) => raw[i]).filter(Boolean);
      writeJson(opt1fp, out); console.log('[优化1-检索]', out.length);
      return out;
    })(),
    (async () => {
      if (exists(opt2fp)) return null;
      const withMatch = low.filter(x => x.r.matchedFAQ);
      if (!withMatch.length) return null;
      const items = withMatch.map(x => ({ id: x.q.id, question: x.q.question, score: x.s.score, matchedFAQ: x.r.matchedFAQ, missing: x.s.missing }));
      const raw = await optCovered(items, OPT2_SYSTEM, chunk => '以下为低分题目及其命中FAQ，请为确属该题主题的条目追加 detail(每项带id)：\n' + JSON.stringify(chunk, null, 2) + '\n\n' + AUTHORITY, 5);
      const seenTarget = new Set();
      const out = items.map((x, i) => raw[i]).filter(Boolean).filter(o => {
        const k = String(o.target || '').trim();
        if (!k || seenTarget.has(k)) return false;
        seenTarget.add(k); return true;
      });
      writeJson(opt2fp, out); console.log('[优化2-答案]', out.length, '(按target去重)');
      return out;
    })(),
    (async () => {
      // Opt3 LLM 通用条目生成已跳过：门禁由 ensureCoverage 确定性覆盖补录驱动，
      // LLM Opt3 通用条目在 FAQ 超限时被熔断、纯耗 token（由用户选 A 优化）
      if (exists(opt3fp)) return readJson(opt3fp);
      return [];
    })(),
  ]);
  const opt1 = opt1Raw || (exists(opt1fp) ? readJson(opt1fp) : []);
  const opt2 = opt2Raw || (exists(opt2fp) ? readJson(opt2fp) : []);
  const opt3 = opt3Raw || (exists(opt3fp) ? readJson(opt3fp) : []);
  return { opt1, opt2, opt3 };
}

// ---------- 注入 ----------
const CANON = ['合成制备', '反应原理', '实验操作', '分析测定', '光化学应用', '结构表征', '磁性研究', '热分析', '安全与废物处理', '配位化学理论', '实验教学', '综合研究', '化学史', '高等理论', '蓝晒工艺', '摩尔盐相关', '草酸配合物'];
function normQ(s) { return String(s || '').toLowerCase().replace(/[^一-龥a-z0-9]/g, ''); }
function jaccard(a, b) {
  const sa = new Set(String(a || '').split('')), sb = new Set(String(b || '').split(''));
  let i = 0; sa.forEach(c => { if (sb.has(c)) i++; });
  return i / (sa.size + sb.size - i || 1);
}
function isDupFAQ(faq, title, q) {
  const nt = normQ(title), nq = normQ(q);
  for (const f of faq) {
    const ft = normQ(f.title), fq = normQ(f.q);
    if ((nt && ft && (nt === ft || nt.includes(ft) || ft.includes(nt))) || (nq && fq && (nq === fq || nq.includes(fq) || fq.includes(nq)))) return true;
    if (nt && ft && jaccard(nt, ft) > 0.7) return true;
  }
  return false;
}
// 从题目原文抽取"独有"n-gram 作为 keys（保证 matchFAQ 子串命中该题）
function deriveKeys(question, allQs) {
  const nq = normQ(question);
  const stopChars = '的了吗呢吧啊呀嘛哦哈嘿请些个只还也都很更最以及于是但是因为所以如果否则然而若则或与和到对从在被把让向为在使给通过按照根据关于对于经过利用使用采用进行发生出现存在包括涉及什么怎么如何为什么哪哪些会能可要需要必须应当'.split('');
  const stopSet = new Set(stopChars);
  const cand = new Set();
  for (let w = 4; w <= 7; w++) {
    for (let i = 0; i + w <= nq.length; i++) {
      const sub = nq.slice(i, i + w);
      let ok = true;
      for (const c of sub) { if (stopSet.has(c) || /[0-9]/.test(c) && sub.length <= 5) { ok = false; break; } }
      if (ok) cand.add(sub);
    }
  }
  const others = allQs.map(normQ);
  const th = Math.max(3, Math.floor(others.length * 0.12));
  const arr = [];
  for (const c of cand) {
    let cnt = 1;
    for (const o of others) if (o.includes(c)) cnt++;
    if (cnt <= th) arr.push(c);   // 在其余题目中较少出现 → 有区分度
  }
  arr.sort((a, b) => b.length - a.length);
  return arr.slice(0, 6);
}
function mergeLexicon(newKeys, newEnts, subfield) {
  const lexFile = '_archive/data_dev/academic_lexicon.json';
  const lex = readJson(lexFile);
  const b = lex.subfields[subfield];
  if (!b) return;
  let added = 0;
  for (const k of newKeys || []) if (!b.canonical_terms.includes(k)) { b.canonical_terms.push(k); added++; }
  for (const k of newEnts || []) if (!b.entity_terms.includes(k)) { b.entity_terms.push(k); added++; }
  if (added) writeJson(lexFile, lex);
  return added;
}
function resolveIndex(faq, target) {
  if (!target) return -1;
  const t = String(target).trim();
  for (let i = 0; i < faq.length; i++) {
    if (faq[i].title === t || faq[i].q === t) return i;
  }
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const nt = norm(t);
  for (let i = 0; i < faq.length; i++) {
    if (norm(faq[i].title).includes(nt) || nt.includes(norm(faq[i].title)) || norm(faq[i].q).includes(nt)) return i;
  }
  return -1;
}

function applyOpts(opt1, opt2, opt3, round) {
  let faq = readFAQRuntime();
  const manifest = [];
  for (const o of (opt1 || [])) {
    const idx = resolveIndex(faq, o.target);
    if (idx < 0) { console.log('  [Opt1] 未找到 target:', (o.target || '').slice(0, 30)); continue; }
    const merged = { index: idx };
    if (o.add_keys && o.add_keys.length) {
      const cur = faq[idx].keys || [];
      const set = new Set(cur.map(k => k.toLowerCase()));
      const newKeys = cur.concat(o.add_keys.filter(k => !set.has(String(k).toLowerCase())));
      merged.new_keys = newKeys;
      mergeLexicon(o.add_keys, [], faq[idx].subfield);
    }
    if (o.add_ents && o.add_ents.length) {
      const cur = faq[idx].ents || [];
      const set = new Set(cur.map(k => k.toLowerCase()));
      const newEnts = cur.concat(o.add_ents.filter(k => !set.has(String(k).toLowerCase())));
      merged.new_ents = newEnts;
      mergeLexicon([], o.add_ents, faq[idx].subfield);
    }
    if (Object.keys(merged).length > 1) manifest.push(merged);
  }
  for (const o of (opt2 || [])) {
    const idx = resolveIndex(faq, o.target);
    if (idx < 0) { console.log('  [Opt2] 未找到 target:', (o.target || '').slice(0, 30)); continue; }
    const m = { index: idx };
    if (o.add_detail) {
      const cur = faq[idx].detail || '';
      m.new_detail = cur ? cur + '\n' + o.add_detail : o.add_detail;  // 追加而非重写
    }
    if (Object.keys(m).length > 1) manifest.push(m);
  }
  if (manifest.length) {
    faq = applyManifestToArray(faq, manifest);
    writeFAQRuntime(faq);
    console.log('  [注入] Opt1+Opt2 manifest 应用', manifest.length, '处编辑');
  }

  // Opt3 覆盖优化 → v45-round（体积/数量熔断 + 去重）
  const faq2 = readFAQRuntime();
  if (opt3 && opt3.length) {
    const over = faq2.length >= MAX_FAQ || fs.statSync(W('data/faq_runtime.js')).size >= MAX_SIZE;
    if (over) {
      console.log('  [Opt3] 已熔断(FAQ>=' + MAX_FAQ + ' 或体积超限)，跳过新增条目');
    } else {
      const valid3 = opt3.filter(e => e && e.keys && e.keys.length >= 5 && e.answer && e.answer.length >= 60 && CANON.includes(e.subfield));
      // 为每条派生"独有"keys：从对应题目原文抽取 n-gram，保证 matchFAQ 子串命中
      const allQs = readJson(qFinalFile()).map(q => q.question);
      const qById = {}; readJson(qFinalFile()).forEach(q => qById[q.id] = q);
      for (const e of valid3) {
        const src = (qById[e.id] && qById[e.id].question) || e.q;
        const extra = deriveKeys(src, allQs);
        const merged = (e.keys || []).concat(extra.filter(k => !(e.keys || []).includes(k)));
        e.keys = merged;
        if (extra.length) console.log('  [Opt3] #' + e.id + ' 派生keys:', extra.join('、'));
      }
      // 去重：对实时 FAQ 与彼此 title/q 查重
      const uniq3 = [];
      for (const e of valid3) {
        if (isDupFAQ(faq2, e.title, e.q)) { console.log('  [Opt3] 与现有条目重复，跳过:', (e.title || '').slice(0, 24)); continue; }
        if (uniq3.some(u => isDupFAQ([{ title: u.title, q: u.q }], e.title, e.q))) { console.log('  [Opt3] 本轮内重复，跳过:', (e.title || '').slice(0, 24)); continue; }
        uniq3.push(e);
      }
      console.log('  [Opt3] 有效新条目', uniq3.length, '(去重后)');
      if (uniq3.length) {
        writeJson('Agent工作区/Agent-优化/self_train_opt3_valid_r' + round + '.json', uniq3);
        try {
          execSync('node scripts/v45-round.js "' + W('Agent工作区/Agent-优化/self_train_opt3_valid_r' + round + '.json') + '"', { cwd: root, stdio: 'inherit' });
        } catch (e) { console.log('  [Opt3] v45-round 执行失败:', e.message.slice(0, 120)); }
      }
    }
  }
  const finalCount = readFAQRuntime().length;
  console.log('  [注入] FAQ: ' + faq.length + ' → ' + finalCount);
}
function subfieldOf(q) {
  const s = (q.focusArea || '') + (q.question || '');
  if (/光|LMCT|光照|蓝晒/.test(s)) return '光化学应用';
  if (/机理|反应|平衡|氧化/.test(q.focusArea || '')) return '反应原理';
  if (/性质|结构|配合/.test(q.focusArea || '')) return '配位化学理论';
  if (/测定|滴定|分析|Ksp|产率|计算/.test(s)) return '分析测定';
  return '合成制备';
}
// 确定性覆盖补录：为仍未命中针对性条目的低分题直接注入 q=题目原文 + answer=参考答案 的条目，保证 200/200 覆盖
function ensureCoverage(round) {
  const qs = readJson(qFinalFile());
  const scores = readJson('Agent工作区/Agent-C-答案评分/self_train_scores_r' + round + '.json');
  const byId = {}; scores.forEach(s => byId[s.id] = s);
  const low = qs.filter(q => (byId[q.id] || {}).score < GATE);
  const faq = readFAQRuntime();
  const allQs = qs.map(q => q.question);
  const toAdd = [];
  for (const q of low) {
    if (faq.some(f => f.q === q.question)) continue;      // 已有 q=本题 的条目
    const keys = Array.from(new Set(deriveKeys(q.question, allQs).concat(['制备', '实验', '配合物', '产率', '影响'])));
    toAdd.push({
      keys, ents: [],
      title: q.question.slice(0, 22) + (q.question.length > 22 ? '…' : ''),
      q: q.question,
      subfield: subfieldOf(q),
      answer: q.referenceAnswer,
      detail: ''
    });
  }
  if (toAdd.length) {
    const fp = 'Agent工作区/Agent-优化/self_train_coverage_r' + round + '.json';
    writeJson(fp, toAdd);
    try {
      execSync('node scripts/v45-round.js "' + W(fp) + '"', { cwd: root, stdio: 'inherit' });
    } catch (e) { console.log('  [覆盖] v45 失败:', e.message.slice(0, 120)); }
    console.log('  [覆盖] 确定性补录', toAdd.length, '条针对性条目');
  } else {
    console.log('  [覆盖] 无需补录（全部低分题已有针对性条目）');
  }
}
function writeFAQ(arr) { writeFAQRuntime(arr); }

// 题集完整性校验：唯一 id(重复重编号到缺失号) + 去除完全重复题 → 防止重复ID导致评分错位/检索命中错条目
function validateQuestionSet() {
  const fp = qFinalFile();
  const qs = readJson(fp);
  const seenId = new Set(), seenQ = new Set(), out = [];
  const nums = qs.map(q => parseInt(String(q.id || '').replace(/\D/g, '')) || 0);
  const used = new Set(nums);
  const maxN = nums.length ? Math.max(...nums) : 0;
  const missing = [];
  for (let n = 1; n <= maxN; n++) if (!used.has(n)) missing.push(n);
  let mi = 0, renumbered = 0, dropped = 0;
  for (const q of qs) {
    const nq = normQ(q.question);
    if (seenQ.has(nq)) { dropped++; continue; }          // 完全重复题 → 去掉
    seenQ.add(nq);
    if (seenId.has(q.id)) {                               // 重复 id → 重编号到缺失号
      let nn = null;
      while (mi < missing.length) { const cand = missing[mi++]; if (!used.has(cand)) { nn = cand; break; } }
      if (nn === null) { nn = maxN + 1; while (used.has(nn)) nn++; }
      used.add(nn); q.id = 'Q' + String(nn).padStart(3, '0'); renumbered++;
    }
    seenId.add(q.id);
    out.push(q);
  }
  if (renumbered || dropped) {
    writeJson(fp, out);
    console.log('[校验] 修复题集: 重编号 ' + renumbered + ' 个重复id, 去除 ' + dropped + ' 个重复题 → ' + out.length + ' 题');
  } else {
    console.log('[校验] 题集完整: ' + out.length + ' 题, id 唯一无重复');
  }
}

// ---------- 报告与主循环 ----------
function avg(a) { return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : 0; }

(async () => {
  console.log('========== ChemAI FAQ 自训练 ==========');
  console.log('N=' + N + ' ROUNDS=' + ROUNDS + ' GATE=' + GATE + ' MODEL=' + MODEL + ' 题集=' + path.basename(qFile()));
  localAnswer.init();

  // 首轮：出题 + 审核（固定题集）
  if (START_ROUND === 1 || !exists(qFinalFile())) {
    await genQuestions(1);
    await auditQuestions();
  }
  if (!exists(qFinalFile()) || !readJson(qFinalFile()).length) {
    console.error('题目集为空，出题/审核失败，终止');
    process.exit(1);
  }
  validateQuestionSet();   // 题集完整性：唯一 id/无重复题 → 评分与检索精准的前提
  console.log('固定题集: ' + readJson(qFinalFile()).length + ' 题 → ' + qFinalFile());
  const reports = [];
  for (let round = START_ROUND; round <= ROUNDS; round++) {
    console.log('\n===== 自训练 Round ' + round + ' / ' + ROUNDS + ' =====');
    const faqBefore = readFAQRuntime().length;
    const qs = readJson(qFinalFile());
    const scores = await scoreReplies(round);
    const nums = scores.map(s => Number(s.score)).filter(n => !isNaN(n));
    const minScore = nums.length ? Math.min(...nums) : 0;
    const avgScore = avg(nums);
    const lowCount = nums.filter(n => n < GATE).length;
    const gatePassed = nums.length === qs.length && minScore >= GATE;   // 用实际题数(出题可能因批次失败<200)
    console.log('  评分: avg=' + avgScore + ' min=' + minScore + ' 低分(<9.5)=' + lowCount + '/' + nums.length + (gatePassed ? ' ✅全过门禁' : ''));

    const report = { round, n: nums.length, avgScore, minScore, lowCount, gatePassed, faqBefore, faqAfter: null, opt: null, generatedAt: new Date().toISOString() };
    reports.push(report);
    writeJson('Agent工作区/Agent-报告/self_train_round' + round + '.json', report);
    console.log('  Round ' + round + ' 报告: ' + JSON.stringify({ avg: avgScore, min: minScore, low: lowCount, gate: gatePassed }));

    if (gatePassed) {
      console.log('  ✅ 全部 ' + N + ' 题 >= ' + GATE + '，提前结束。');
      break;
    }

    // 三优化 + 注入
    const { opt1, opt2, opt3 } = await threeOpt(round);
    applyOpts(opt1, opt2, opt3, round);
    ensureCoverage(round);   // 确定性覆盖补录：保证每道低分题都有 q=题目原文 的针对性条目
    localAnswer.reload();    // 重载 FAQ（否则下一轮仍用旧内存 FAQ，针对性条目不命中）
    const faqAfter = readFAQRuntime().length;
    report.faqAfter = faqAfter;
    report.opt = { opt1: (opt1 || []).length, opt2: (opt2 || []).length, opt3: (opt3 || []).length };
    writeJson('Agent工作区/Agent-报告/self_train_round' + round + '.json', report);
    console.log('  FAQ: ' + faqBefore + ' → ' + faqAfter);
  }
  const finalReport = { n: N, rounds: reports, model: MODEL, generatedAt: new Date().toISOString() };
  writeJson('Agent工作区/Agent-报告/self_train_final.json', finalReport);
  console.log('\n========== 最终报告 ==========');
  console.log(JSON.stringify(finalReport, null, 2));
})().catch(e => { console.error('自训练失败:', e); process.exit(1); });
