/**
 * 分类归一化工具 — 所有脚本共用的唯一分类处理模块
 * 数据来源: _archive/data_dev/categories.json (唯一权威)
 */
const path = require('path');
const fs = require('fs');

const CATEGORIES_PATH = path.join(__dirname, '..', '_archive', 'data_dev', 'categories.json');
const CATEGORIES = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8'));

// 构建快速查找表: alias → canonical
const aliasToCanon = {};
for (const canon of CATEGORIES.canonical) {
  aliasToCanon[canon] = canon; // self-map
}
for (const [alias, canonical] of Object.entries(CATEGORIES.aliases)) {
  aliasToCanon[alias] = canonical;
}

// canonical 名称集合
const canonicalSet = new Set(CATEGORIES.canonical);

/**
 * 将任意 subfield/category 值归一化为 canonical 名称
 * @param {string|null|undefined} value — 原始分类值
 * @returns {string} canonical 分类名称，fallback 为 '综合研究'
 */
function normalize(value) {
  if (!value || typeof value !== 'string') return '综合研究';
  const trimmed = value.trim();
  if (!trimmed) return '综合研究';

  // 1. 直接匹配 canonical
  if (canonicalSet.has(trimmed)) return trimmed;

  // 2. alias 精确匹配
  if (aliasToCanon[trimmed]) return aliasToCanon[trimmed];

  // 3. 模糊匹配 (canonical contains input or vice versa)
  const lower = trimmed.toLowerCase();
  for (const canon of CATEGORIES.canonical) {
    if (canon.toLowerCase().includes(lower) || lower.includes(canon.toLowerCase())) {
      return canon;
    }
  }
  for (const [alias, canon] of Object.entries(CATEGORIES.aliases)) {
    if (alias.toLowerCase().includes(lower) || lower.includes(alias.toLowerCase())) {
      return canon;
    }
  }

  // 4. 未匹配 — 警告并保持原值
  console.warn('[category-utils] 未识别的分类: "' + trimmed + '"，保留原值');
  return trimmed;
}

/**
 * 获取 canonical 分类列表
 * @returns {string[]}
 */
function getCanonicalList() {
  return CATEGORIES.canonical.slice();
}

/**
 * 获取章节中文名称
 * @param {string} code — 如 'ch1'
 * @returns {string} 中文名称，未匹配返回原 code
 */
function getChapterName(code) {
  return (CATEGORIES.chapters && CATEGORIES.chapters[code]) || code;
}

/**
 * 获取所有 chapter 映射
 * @returns {object}
 */
function getChapters() {
  return Object.assign({}, CATEGORIES.chapters);
}

module.exports = { normalize, getCanonicalList, getChapterName, getChapters, CATEGORIES };
