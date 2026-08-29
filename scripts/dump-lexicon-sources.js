'use strict';
/**
 * v43 学术词表构建 · 词源聚合脚本（只读）
 *
 * 从 corpus.json（objects/methods/title）、manual.json（section keywords）、
 * categories.json（17 规范 subfield）聚合"学术名词候选"，输出供 LLM 审定的中间产物。
 *
 * 输出: _archive/data_dev/lexicon_sources_dump.json
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
function readJson(fp) {
  let r = fs.readFileSync(fp, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.slice(1);
  return JSON.parse(r);
}
const corpus = readJson(path.join(DATA, 'corpus.json'));
const manual = readJson(path.join(DATA, 'manual.json'));
const cats = readJson(path.join(__dirname, '..', '_archive', 'data_dev', 'categories.json'));

const CANONICAL = cats.canonical;          // 17 规范
const ALIASES = cats.aliases || {};        // 别名 → 规范
const CORPUS_SUBFIELDS = corpus.subfields || [];

function normSubfield(s) {
  if (!s) return null;
  if (CANONICAL.includes(s)) return s;
  if (ALIASES[s]) return ALIASES[s];
  // 部分别名映射可能是反向/嵌套，做一次兜底
  return s;
}

// 把含管道/箭头/运算的字符串切成词片段
function splitTerms(str) {
  if (!str) return [];
  return String(str)
    .split(/[、，,；;/\n|→→\+\-=]/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && /[A-Za-z一-龥₂₃₄₅₆₇₈₉·⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/.test(t));
}

// 抽化学式形态 token（含下标/方括号/离子符号）
function formulaTokens(strs) {
  const out = [];
  const re = /[A-Z][A-Za-z0-9₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻·\-]*[A-Za-z0-9₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻·\]]?/g;
  for (const s of strs) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const t = m[0];
      if (/^[A-Z]/.test(t) && t.length >= 2) out.push(t);
    }
  }
  return out;
}

// 按子领域聚合
const bySubfield = {};
function ensure(sf) {
  if (!bySubfield[sf]) bySubfield[sf] = { corpus_objects: [], corpus_methods: [], corpus_titles: [], manual_keywords: [] };
  return bySubfield[sf];
}

// --- 语料 ---
const corpusBySubfield = {};
for (const e of corpus.entries) {
  const sf = normSubfield(e.subfield) || e.subfield;
  corpusBySubfield[sf] = corpusBySubfield[sf] || [];
  corpusBySubfield[sf].push(e);
}

for (const sf of Object.keys(corpusBySubfield)) {
  const bucket = ensure(sf);
  const entries = corpusBySubfield[sf];
  for (const e of entries) {
    splitTerms(e.objects).forEach(t => bucket.corpus_objects.push(t));
    splitTerms(e.methods).forEach(t => bucket.corpus_methods.push(t));
  }
  // title：按 doctype 优先级排序，取前 25
  const prio = { '实验研究': 0, '实验教学': 1, '综述': 2, '教科书': 2 };
  const sorted = [...entries].sort((a, b) => {
    const pa = prio[a.doctype] !== undefined ? prio[a.doctype] : 3;
    const pb = prio[b.doctype] !== undefined ? prio[b.doctype] : 3;
    return pa - pb;
  });
  bucket.corpus_titles = sorted.slice(0, 25).map(e => ({
    id: e.id, title: e.title, doctype: e.doctype, difficulty: e.difficulty
  }));
  bucket._corpus_count = entries.length;
}

// --- 讲义 ---
const flatManualKw = [];
for (const ch of manual.chapters || []) {
  for (const sec of ch.sections || []) {
    const sf = normSubfield(sec.category) || sec.category;
    const bucket = ensure(sf);
    (sec.keywords || []).forEach(k => { bucket.manual_keywords.push(k); flatManualKw.push(k); });
  }
}

// --- 化学式 token（跨全库）---
const flatFormula = [];
for (const sf of Object.keys(bySubfield)) {
  const b = bySubfield[sf];
  const tok = formulaTokens([...b.corpus_objects, ...b.corpus_methods, ...b.corpus_titles.map(t => t.title)]);
  flatFormula.push(...tok);
}

// 去重 + 计数
for (const sf of Object.keys(bySubfield)) {
  const b = bySubfield[sf];
  b.corpus_objects = dedupe(b.corpus_objects);
  b.corpus_methods = dedupe(b.corpus_methods);
  b.manual_keywords = dedupe(b.manual_keywords);
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const dump = {
  version: '1.0',
  generated_at: '2026-08-14',
  canonical_subfields: CANONICAL,
  corpus_subfields: CORPUS_SUBFIELDS,
  by_subfield: bySubfield,
  flat_manual_keywords: dedupe(flatManualKw),
  flat_formula_tokens: dedupe(flatFormula).slice(0, 400),
  stats: {
    subfields_in_corpus: Object.keys(corpusBySubfield).length,
    manual_sections: manual.chapters.reduce((a, c) => a + (c.sections || []).length, 0)
  }
};

fs.writeFileSync(path.join(__dirname, '..', '_archive', 'data_dev', 'lexicon_sources_dump.json'), JSON.stringify(dump, null, 1), 'utf8');

// 控制台摘要
console.log('=== 词源聚合摘要 ===');
console.log('规范 subfield: ' + CANONICAL.length + ' | 语料出现 subfield: ' + Object.keys(corpusBySubfield).length);
for (const sf of Object.keys(bySubfield)) {
  const b = bySubfield[sf];
  if (b.corpus_objects.length || b.manual_keywords.length) {
    console.log('  ' + sf.padEnd(8) +
      ' obj=' + b.corpus_objects.length +
      ' mtd=' + b.corpus_methods.length +
      ' ttl=' + b.corpus_titles.length +
      ' manualKw=' + b.manual_keywords.length +
      ' (corpusCount=' + (b._corpus_count || 0) + ')');
  }
}
console.log('化学式 token 数: ' + dump.flat_formula_tokens.length);
console.log('输出: _archive/data_dev/lexicon_sources_dump.json');
