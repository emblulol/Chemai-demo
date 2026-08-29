/**
 * score_answers.js - ROUND 1
 * Automated LLM-as-Judge scoring system.
 *
 * Pipeline per question:
 *   1. RAG context retrieval (FAQ + BM25 over KB)
 *   2. Call DeepSeek API with context to get AI answer
 *   3. Call DeepSeek API as judge to score the answer on 4 dimensions
 *
 * Output:
 *   - Per-question scores printed to stdout
 *   - Detailed report saved to score_report_round1.json
 *
 * Usage: node score_answers.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

// ===================== CONFIGURATION =====================
const API_KEY = process.env.DEEPSEEK_KEY || '';
if (!API_KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量，请先设置后运行');
  process.exit(1);
}
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const ROUND = process.argv[2] ? parseInt(process.argv[2]) : 1;
console.log('Score Answers — Round ' + ROUND);
const MODEL = 'deepseek-flash';
const RATE_LIMIT_MS = 500;

// ===================== FILE LOADING =====================
const { readJSON } = require('../scripts/rag-utils');

// Resolve input file: try r5 → r4 → r3 → r2 → core → round1
let questionFile = path.join(__dirname, '..', '试题迭代记录/round3/test_questions_core_r14.json');
if (!fs.existsSync(questionFile)) {
  questionFile = path.join(__dirname, '..', '试题迭代记录/round3/test_questions_core_r10.json');
}

const QUESTION_DATA = readJSON(questionFile);
const QUESTIONS = Array.isArray(QUESTION_DATA) ? QUESTION_DATA : (QUESTION_DATA.questions || []);
const KB = readJSON(path.join(__dirname, '..', '_archive', 'data_dev', 'kb.json'));
const FAQ = readJSON(path.join(__dirname, '..', 'data', 'faq_unified.json'));

console.log('='.repeat(70));
console.log('LLM-as-Judge Scoring System');
console.log('='.repeat(70));
console.log('Questions file : ' + path.basename(questionFile));
console.log('Questions count : ' + QUESTIONS.length);
console.log('KB entries      : ' + KB.length);
console.log('FAQ entries     : ' + FAQ.length);
console.log('Model           : ' + MODEL);
console.log('Rate limit      : ' + RATE_LIMIT_MS + 'ms between calls');
console.log('');

// ===================== RAG PIPELINE =====================
// Same logic as assistant.html / eval_llm.js

const SUBMAP = {'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','⁻':'-','⁺':'+'};
const norm = s => String(s || '').toLowerCase().replace(/[₀-₉⁻⁺]/g, c => SUBMAP[c] || c).replace(/\s+/g, '');
const AMBIGUOUS = new Set(['℃','°c','40','40℃','100','100℃','0','0℃','20','20℃','g','ml','mol','%','h','ph','水','酸','碱','盐','色','热','光','铁','氧','氢','碳']);

// NOTE: local matchFAQ/kbTokens retained for custom scoring logic
// ---- FAQ keyword + bigram match ----
function matchFAQ(q) {
  const nq = norm(q);
  const qBigrams = new Set();
  for (let i = 0; i < nq.length - 1; i++) qBigrams.add(nq.slice(i, i + 2));

  let best = null, bestScore = 0;
  for (const f of FAQ) {
    let kh = 0, specificHits = 0;
    for (const k of (f.keys || [])) {
      const nk = norm(k);
      if (nk.length < 2 || AMBIGUOUS.has(nk)) continue;
      if (nq.includes(nk)) { kh++; if (nk.length >= 4) specificHits++; }
    }
    let eh = 0;
    for (const en of (f.ents || [])) {
      const nen = norm(en);
      if (nen.length >= 2 && nq.includes(nen)) eh++;
    }
    const faqText = norm((f.title || '') + ' ' + (f.answer || ''));
    const faqBigrams = new Set();
    for (let i = 0; i < faqText.length - 1; i++) faqBigrams.add(faqText.slice(i, i + 2));
    let bg = 0;
    for (const b of qBigrams) { if (faqBigrams.has(b)) bg++; }
    const score = kh * 3 + specificHits * 6 + eh * 8 + Math.min(bg * 0.4, 15);
    const trig = (kh >= 1) || (eh >= 1) || (bg >= 15);
    if (trig && score >= bestScore) { bestScore = score; best = f; }
  }
  return best;
}

// NOTE: local matchFAQ/kbTokens retained for custom scoring logic
// ---- BM25 KB search ----
function kbTokens(text) {
  const s = norm(String(text || ''));
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[一-鿿]/.test(c)) {
      let j = i;
      while (j < s.length && /[一-鿿]/.test(s[j])) j++;
      const run = s.slice(i, j);
      for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2));
      i = j;
    } else if (/[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(s[j])) j++;
      const tk = s.slice(i, j);
      if (tk.length >= 2 || /\d/.test(tk)) out.push(tk);
      i = j;
    } else i++;
  }
  return out;
}

let BM25_IDX = null;
function kbIndex() {
  if (BM25_IDX) return BM25_IDX;
  const docs = KB.map(en => {
    const parts = [];
    kbTokens(en.topic || '').forEach(x => { parts.push(x, x, x); });
    kbTokens((en.keys || []).join(', ')).forEach(x => { parts.push(x, x); });
    kbTokens(en.answer || '').forEach(x => parts.push(x));
    const tf = {}; parts.forEach(x => tf[x] = (tf[x] || 0) + 1);
    return { en, tf, len: parts.length || 1 };
  });
  const df = {}; let tot = 0;
  docs.forEach(d => { tot += d.len; for (const t in d.tf) df[t] = (df[t] || 0) + 1; });
  BM25_IDX = { docs, df, avgdl: tot / (docs.length || 1), N: docs.length };
  return BM25_IDX;
}

function bm25MatchKB(q) {
  const idx = kbIndex();
  const qtoks = kbTokens(q).filter(t => t.length >= 2);
  const nq = norm(q);
  const k1 = 1.5, b = 0.75;
  const arr = [];
  for (const d of idx.docs) {
    let sc = 0;
    for (const t of qtoks) {
      const f = d.tf[t]; if (!f) continue;
      const idf = Math.log(1 + (idx.N - idx.df[t] + 0.5) / (idx.df[t] + 0.5));
      sc += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / idx.avgdl));
    }
    for (const k of (d.en.keys || [])) {
      const nk = norm(k);
      if (nk.length >= 3 && nq.includes(nk)) sc += 6;
    }
    for (const t of (d.en.ents || [])) {
      const nt = norm(t);
      if (nt.length >= 2 && nq.includes(nt)) sc += 8;
    }
    if (sc <= 0) continue;
    arr.push({ en: d.en, score: sc });
  }
  if (!arr.length) return null;
  arr.sort((a, b2) => b2.score - a.score);
  if (arr[0].score < 3.0) return null;
  return {
    entry: arr[0].en,
    score: arr[0].score,
    second: arr[1] ? arr[1].en : null,
    third: arr[2] ? arr[2].en : null
  };
}

// ---- Build context from RAG hits ----
function buildContext(q) {
  const parts = [];
  const faq = matchFAQ(q);
  if (faq) {
    parts.push('【FAQ · ' + faq.title + '】\n' + (faq.answer || '') + (faq.detail ? '\n' + faq.detail : ''));
  }
  const m = bm25MatchKB(q);
  if (m) {
    parts.push('【KB · ' + m.entry.topic + '】\n' + (m.entry.answer || ''));
    if (m.second && m.second.topic && m.second.answer) {
      parts.push('【KB补充 · ' + m.second.topic + '】\n' + (m.second.answer || ''));
    }
  }
  const CHEATSHEET = '【实验关键参数】莫尔盐M=392.14g/mol | 产物M=491.25g/mol | 标准5.0g莫尔盐→理论6.26g | 氧化40℃ | 结晶水失重100℃ | 草酸pKa1=1.25 pKa2=4.27 | H2O2 φ°=+1.77V | Fe3+/Fe2+ φ°=+0.771V | [Fe(C2O4)3]3- lgKf≈20.2 | 高自旋d5 μeff≈5.92BM';
  parts.push(CHEATSHEET);
  return parts.join('\n\n---\n\n');
}

// ---- DeepSeek API call ----
function callLLM(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 600,
      temperature: 0.2
    });
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content);
          } else if (json.error) {
            reject(new Error('API error: ' + JSON.stringify(json.error)));
          } else {
            reject(new Error('Unexpected response: ' + d.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('JSON parse + API error: ' + e.message + ' | ' + d.slice(0, 100)));
        }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// ---- Get AI answer via RAG pipeline ----
async function getAIAnswer(questionText) {
  const context = buildContext(questionText);
  const hasContext = context && context.length > 50;

  if (!hasContext) {
    return { answer: '(NO RAG CONTEXT FOUND)', hasContext: false, context: '' };
  }

  const systemPrompt = '你是ChemAI实验助手。严格基于以下参考内容回答化学问题。标注来源（如【FAQ】或【KB】）。如果参考内容无法回答问题，请说明"知识清单未命中"。回答简洁准确，要点清晰。';
  const fullPrompt = systemPrompt + '\n\n' + context;

  try {
    const answer = await callLLM(fullPrompt, questionText);
    return { answer, hasContext: true, context };
  } catch (e) {
    return { answer: '(API ERROR: ' + e.message.slice(0, 100) + ')', hasContext: true, context, error: e.message };
  }
}

// ---- Build expected answer text for judge ----
function buildExpectedAnswer(q) {
  let text = '';

  if (q.type === 'single' || q.type === 'multiple' || q.type === 'truefalse') {
    // Find the correct option text(s)
    if (q.options && q.options.length > 0) {
      const answerLetters = q.answer.replace(/\s/g, '').toUpperCase().split(',').filter(Boolean);
      const correctOptions = [];
      for (const letter of answerLetters) {
        const idx = letter.charCodeAt(0) - 65; // A=0, B=1, ...
        if (idx >= 0 && idx < q.options.length) {
          correctOptions.push(letter + '. ' + q.options[idx].replace(/^[A-H][\.。、）\)]\s*/, ''));
        }
      }
      if (correctOptions.length > 0) {
        text += '正确答案：' + correctOptions.join('；') + '\n';
      }
    }
    if (!text) {
      text += '正确答案：' + q.answer + '\n';
    }
    text += '\n解析：' + (q.explanation || '');
  } else if (q.type === 'fill') {
    text = '标准答案：' + q.answer + '\n\n解析：' + (q.explanation || '');
  } else if (q.type === 'short') {
    text = '关键点：' + (q.answer || '') + '\n\n详细解析：' + (q.explanation || '');
  } else if (q.type === 'calculation') {
    text = '标准答案：' + (q.answer || '') + '\n\n计算过程/解析：' + (q.explanation || '');
  } else {
    text = '标准答案：' + (q.answer || '') + '\n\n解析：' + (q.explanation || '');
  }

  return text;
}

// ---- LLM-as-Judge scoring ----
async function scoreAnswer(question, aiAnswer) {
  const expectedAnswer = buildExpectedAnswer(question);

  const judgePrompt = `请作为评分官评估以下AI助手的回答质量。

【问题】${question.question}
【标准答案/关键点】${expectedAnswer}
【AI助手的回答】${aiAnswer}

请按以下4个维度打分（每项0-25分）：
1. 事实准确性 (25分): AI回答中的事实是否与标准答案一致？数值、化学式、人名是否准确？
2. 完整性 (25分): 是否覆盖了所有关键点？
3. 来源引用 (25分): 是否正确引用和使用了提供的参考知识库内容？
4. 表述清晰度 (25分): 回答是否结构清晰、易于理解？

请输出JSON格式的评分结果：
{"accuracy": X, "completeness": X, "source_usage": X, "clarity": X, "total": X, "brief_comment": "一句话评价"}`;

  const systemPrompt = '你是一个严格的化学考试评分官。请客观公正地打分。只输出JSON格式结果，不要输出其他内容。';

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callLLM(systemPrompt, judgePrompt);
      // Try to extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate the fields
        const scores = {
          accuracy: Math.max(0, Math.min(25, parseInt(parsed.accuracy) || 0)),
          completeness: Math.max(0, Math.min(25, parseInt(parsed.completeness) || 0)),
          source_usage: Math.max(0, Math.min(25, parseInt(parsed.source_usage) || 0)),
          clarity: Math.max(0, Math.min(25, parseInt(parsed.clarity) || 0)),
          total: 0,
          brief_comment: String(parsed.brief_comment || '无评价')
        };
        scores.total = scores.accuracy + scores.completeness + scores.source_usage + scores.clarity;
        return scores;
      }
      // If no JSON found, retry
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 300));
      } else {
        return { accuracy: 0, completeness: 0, source_usage: 0, clarity: 0, total: 0, brief_comment: '评分失败: ' + e.message.slice(0, 80) };
      }
    }
  }

  return { accuracy: 0, completeness: 0, source_usage: 0, clarity: 0, total: 0, brief_comment: '评分失败: 无法解析JSON响应' };
}

// ---- Chapter names for display (从统一分类总集读取) ----
const CATEGORIES_JSON = readJSON(path.join(__dirname, '..', '_archive', 'data_dev', 'categories.json'));
const CHAPTER_NAMES = CATEGORIES_JSON.chapters || {};

// ===================== MAIN EXECUTION =====================
async function main() {
  const total = QUESTIONS.length;
  const results = [];
  let grandTotalScore = 0;
  let apiErrors = 0;
  const categoryScores = {}; // { chapter: { totalScore, count } }
  const typeScores = {};     // { type: { totalScore, count } }
  const difficultyScores = {}; // { level: { totalScore, count } }

  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const q = QUESTIONS[i];
    const idx = i + 1;

    // Progress indicator
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const eta = total > idx ? Math.floor(elapsed / idx * (total - idx)) : 0;
    process.stdout.write(`\r[${idx}/${total}] ${q.id} (${q.type}, d${q.difficulty}) | elapsed: ${elapsed}s | ETA: ${eta}s`);

    // Step 1: Get AI answer via RAG pipeline
    let aiAnswer;
    try {
      const result = await getAIAnswer(q.question);
      aiAnswer = result.answer;
    } catch (e) {
      aiAnswer = '(ERROR: ' + e.message.slice(0, 80) + ')';
      apiErrors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

    // Step 2: Score with LLM-as-Judge
    let scores;
    try {
      scores = await scoreAnswer(q, aiAnswer);
    } catch (e) {
      scores = { accuracy: 0, completeness: 0, source_usage: 0, clarity: 0, total: 0, brief_comment: 'JUDGE ERROR: ' + e.message.slice(0, 80) };
      apiErrors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

    // Accumulate
    grandTotalScore += scores.total;

    const chapter = q.chapter || 'unknown';
    if (!categoryScores[chapter]) categoryScores[chapter] = { totalScore: 0, count: 0 };
    categoryScores[chapter].totalScore += scores.total;
    categoryScores[chapter].count++;

    const qtype = q.type || 'unknown';
    if (!typeScores[qtype]) typeScores[qtype] = { totalScore: 0, count: 0 };
    typeScores[qtype].totalScore += scores.total;
    typeScores[qtype].count++;

    const diffKey = 'd' + (q.difficulty || 1);
    if (!difficultyScores[diffKey]) difficultyScores[diffKey] = { totalScore: 0, count: 0 };
    difficultyScores[diffKey].totalScore += scores.total;
    difficultyScores[diffKey].count++;

    // Store detailed result
    results.push({
      id: q.id,
      chapter: q.chapter,
      type: q.type,
      difficulty: q.difficulty,
      topic: q.topic,
      question: q.question.slice(0, 100),
      expected_answer: buildExpectedAnswer(q).slice(0, 200),
      ai_answer: aiAnswer.slice(0, 300),
      scores: scores
    });
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgScore = total > 0 ? (grandTotalScore / total).toFixed(2) : '0.00';

  // ===================== FINAL OUTPUT =====================
  console.log('\n\n');
  console.log('='.repeat(70));
  console.log('SCORING COMPLETE  (' + totalElapsed + 's)');
  console.log('='.repeat(70));
  console.log('');
  console.log('  AVERAGE SCORE:  ' + avgScore + ' / 100');
  console.log('  Total questions: ' + total);
  console.log('  API errors:      ' + apiErrors);
  console.log('');

  // Category breakdown
  console.log('-'.repeat(70));
  console.log('BY CHAPTER (Category Breakdown):');
  console.log('-'.repeat(70));
  const chOrder = Object.keys(CHAPTER_NAMES);
  for (const ch of chOrder) {
    if (categoryScores[ch]) {
      const d = categoryScores[ch];
      const avg = (d.totalScore / d.count).toFixed(1);
      const bar = '█'.repeat(Math.round(d.totalScore / d.count / 5));
      console.log('  ' + ch + ' ' + (CHAPTER_NAMES[ch] || 'unknown').padEnd(20) + ' : ' + String(avg).padStart(6) + ' / 100  (' + d.count + ' questions) ' + bar);
    }
  }
  console.log('');

  // By difficulty
  console.log('-'.repeat(70));
  console.log('BY DIFFICULTY:');
  console.log('-'.repeat(70));
  const diffOrder = ['d1', 'd2', 'd3', 'd4', 'd5'];
  for (const dk of diffOrder) {
    if (difficultyScores[dk]) {
      const d = difficultyScores[dk];
      const avg = (d.totalScore / d.count).toFixed(1);
      const bar = '█'.repeat(Math.round(d.totalScore / d.count / 5));
      console.log('  Level ' + dk.replace('d', '') + ' : ' + String(avg).padStart(6) + ' / 100  (' + d.count + ' questions) ' + bar);
    }
  }
  console.log('');

  // By type
  console.log('-'.repeat(70));
  console.log('BY QUESTION TYPE:');
  console.log('-'.repeat(70));
  const typeOrder = ['single', 'multiple', 'truefalse', 'fill', 'short', 'calculation'];
  for (const tp of typeOrder) {
    if (typeScores[tp]) {
      const d = typeScores[tp];
      const avg = (d.totalScore / d.count).toFixed(1);
      const bar = '█'.repeat(Math.round(d.totalScore / d.count / 5));
      console.log('  ' + tp.padEnd(12) + ' : ' + String(avg).padStart(6) + ' / 100  (' + d.count + ' questions) ' + bar);
    }
  }
  console.log('');

  // Questions below 70 (needs improvement)
  console.log('-'.repeat(70));
  console.log('QUESTIONS SCORING BELOW 70 (NEEDS IMPROVEMENT):');
  console.log('-'.repeat(70));
  const below70 = results.filter(r => r.scores.total < 70);
  if (below70.length === 0) {
    console.log('  (none - all questions scored 70+)');
  } else {
    below70.sort((a, b) => a.scores.total - b.scores.total);
    for (const r of below70) {
      console.log('  ' + r.id + ' [' + r.scores.total + '] ' + r.type + ' ' + r.topic + ' | ' + r.scores.brief_comment);
    }
    console.log('');
    console.log('  Total below 70: ' + below70.length + ' / ' + total + ' (' + (below70.length / total * 100).toFixed(1) + '%)');
  }

  // Top performers
  console.log('');
  console.log('-'.repeat(70));
  console.log('TOP 10 SCORING QUESTIONS:');
  console.log('-'.repeat(70));
  const top10 = [...results].sort((a, b) => b.scores.total - a.scores.total).slice(0, 10);
  for (const r of top10) {
    console.log('  ' + r.id + ' [' + r.scores.total + '] ' + r.type + ' ' + r.topic + ' | A:' + r.scores.accuracy + ' C:' + r.scores.completeness + ' S:' + r.scores.source_usage + ' L:' + r.scores.clarity);
  }

  // Bottom 10
  console.log('');
  console.log('-'.repeat(70));
  console.log('BOTTOM 10 SCORING QUESTIONS:');
  console.log('-'.repeat(70));
  const bottom10 = [...results].sort((a, b) => a.scores.total - b.scores.total).slice(0, 10);
  for (const r of bottom10) {
    console.log('  ' + r.id + ' [' + r.scores.total + '] ' + r.type + ' ' + r.topic + ' | A:' + r.scores.accuracy + ' C:' + r.scores.completeness + ' S:' + r.scores.source_usage + ' L:' + r.scores.clarity + ' | ' + r.scores.brief_comment);
  }

  // Overall dimension averages
  console.log('');
  console.log('-'.repeat(70));
  console.log('DIMENSION AVERAGES (out of 25):');
  console.log('-'.repeat(70));
  const dims = { accuracy: 0, completeness: 0, source_usage: 0, clarity: 0 };
  for (const r of results) {
    dims.accuracy += r.scores.accuracy;
    dims.completeness += r.scores.completeness;
    dims.source_usage += r.scores.source_usage;
    dims.clarity += r.scores.clarity;
  }
  console.log('  事实准确性 (Accuracy):       ' + (dims.accuracy / total).toFixed(2) + ' / 25');
  console.log('  完整性 (Completeness):       ' + (dims.completeness / total).toFixed(2) + ' / 25');
  console.log('  来源引用 (Source Usage):     ' + (dims.source_usage / total).toFixed(2) + ' / 25');
  console.log('  表述清晰度 (Clarity):        ' + (dims.clarity / total).toFixed(2) + ' / 25');

  // Save report
  const report = {
    round: 1,
    generated_at: new Date().toISOString(),
    input_file: path.basename(questionFile),
    config: {
      model: MODEL,
      rate_limit_ms: RATE_LIMIT_MS,
      total_elapsed_seconds: parseFloat(totalElapsed),
      api_errors: apiErrors
    },
    summary: {
      total_questions: total,
      average_score: parseFloat(avgScore),
      questions_below_70: below70.length,
      questions_below_70_pct: parseFloat((below70.length / total * 100).toFixed(1))
    },
    dimension_averages: {
      accuracy: parseFloat((dims.accuracy / total).toFixed(2)),
      completeness: parseFloat((dims.completeness / total).toFixed(2)),
      source_usage: parseFloat((dims.source_usage / total).toFixed(2)),
      clarity: parseFloat((dims.clarity / total).toFixed(2))
    },
    by_chapter: {},
    by_difficulty: {},
    by_type: {},
    detailed_results: results
  };

  // Fill by_chapter with averages
  for (const [ch, d] of Object.entries(categoryScores)) {
    report.by_chapter[ch] = {
      name: CHAPTER_NAMES[ch] || ch,
      count: d.count,
      average_score: parseFloat((d.totalScore / d.count).toFixed(2))
    };
  }

  // Fill by_difficulty
  for (const [dk, d] of Object.entries(difficultyScores)) {
    report.by_difficulty[dk] = {
      count: d.count,
      average_score: parseFloat((d.totalScore / d.count).toFixed(2))
    };
  }

  // Fill by_type
  for (const [tp, d] of Object.entries(typeScores)) {
    report.by_type[tp] = {
      count: d.count,
      average_score: parseFloat((d.totalScore / d.count).toFixed(2))
    };
  }

  // 写入总集 reports_master.json
  const masterPath = path.join(__dirname, '..', 'Agent工作区/Agent-报告/reports_master.json');
  let master = { version: 'unified', runs: [] };
  if (fs.existsSync(masterPath)) {
    try { master = JSON.parse(fs.readFileSync(masterPath, 'utf8')); } catch (e) { }
  }
  const runName = 'score-round' + ROUND;
  master.runs = master.runs.filter(r => r.name !== runName);
  master.runs.push({
    name: runName,
    description: '评分报告 第' + ROUND + '轮',
    generatedAt: new Date().toISOString(),
    data: report
  });
  master.summary = { ...(master.summary || {}), lastScoreRound: ROUND, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(masterPath, JSON.stringify(master, null, 2), 'utf8');

  console.log('');
  console.log('='.repeat(70));
  console.log('AVERAGE SCORE: ' + avgScore + ' / 100');
  console.log('Report saved to: reports_master.json (' + runName + ')');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('\n\nFATAL ERROR: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
