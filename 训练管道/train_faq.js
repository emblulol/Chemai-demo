/**
 * Train FAQ: enrich keys with question-variant patterns
 * ⚠ DEPRECATED (v43): 该脚本向 keys 机械注入问法变体/泛词（"如何操作""数值是多少"等），
 * 是关键词噪声源。运行版 assistant.html 已改用语料驱动学术词表 _archive/data_dev/academic_lexicon.json。
 * 不要再次运行本脚本，否则会重新注入噪声。见 scripts/lib-assistant-faq.js。
 * Run: node train_faq.js
 */
const fs = require('fs');
const path = require('path');
const { readJSON } = require('../scripts/rag-utils');

const FAQ = readJSON(path.join(__dirname, '..', 'data', 'faq_unified.json'));

// Question patterns to add for different FAQ topics
const QUESTION_PATTERNS = {
  // Temperature-related
  temp: ['温度', '多少度', '几度', '加热温度', '水浴温度', '控温', '温度控制', '为什么这个温度'],
  // Reason/why
  why: ['为什么', '原因', '理由', '原理', '机理', '解释', '为何'],
  // How-to
  how: ['怎么', '如何', '怎样', '步骤', '操作', '方法', '做法', '过程', '流程'],
  // What-is
  what: ['是什么', '什么叫', '什么是', '定义', '含义', '概念'],
  // Quantity
  quant: ['多少', '几克', '几mol', '多少克', '多少mol', '浓度', '用量', '质量', '数量'],
  // Compare
  comp: ['区别', '比较', '对比', '哪个好', '哪种', '优劣', '不同'],
};

// Chemistry-specific compound name variants
const CHEM_VARIANTS = {
  '三草酸合铁酸钾': ['三草酸合铁', '草酸铁钾', 'k3[fe(c2o4)3]', 'ferrioxalate', '产物', '产品', '目标产物'],
  '过氧化氢': ['双氧水', 'h2o2', 'hydrogen peroxide', '氧化剂'],
  '草酸': ['乙二酸', 'h2c2o4', 'oxalic acid', '沉淀剂', '配位剂'],
  '莫尔盐': ['摩尔盐', '硫酸亚铁铵', '(nh4)2fe(so4)2', 'mohr salt', '铁源', '亚铁盐'],
  '乙醇': ['酒精', 'c2h5oh', 'ethanol', '无水乙醇'],
  '草酸钾': ['k2c2o4', '草酸钾饱和溶液'],
  '硫酸': ['h2so4', '稀硫酸', 'sulfuric acid'],
  '高锰酸钾': ['kmno4', 'potassium permanganate'],
  '铁氰化钾': ['k3[fe(cn)6]', '赤血盐', 'potassium ferricyanide'],
  '莫尔盐': ['摩尔盐', '硫酸亚铁铵'],
  '普鲁士蓝': ['滕氏蓝', 'prussian blue', '蓝色沉淀'],
  '氢氧化铁': ['fe(oh)3', '红褐色沉淀', 'iron hydroxide'],
};

// Operation/step variants
const OP_VARIANTS = {
  '抽滤': ['减压过滤', '吸滤', '布氏漏斗', '真空过滤'],
  '结晶': ['析晶', '晶体析出', '结晶方法', '怎样结晶'],
  '洗涤': ['洗沉淀', '清洗', '淋洗', '洗涤方法'],
  '滴定': ['kmno4滴定', '氧化还原滴定', '标定'],
  '称量': ['称取', '称重', '天平'],
  '溶解': ['溶于', '溶解性', '溶解度'],
  '加热': ['水浴加热', '恒温', '控温加热'],
};

let enriched = 0;

for (const entry of FAQ) {
  const existingKeys = new Set((entry.keys || []).map(k => k.toLowerCase().trim()));
  const newKeys = [];
  const title = (entry.title || '').toLowerCase();
  const answer = (entry.answer || '').toLowerCase();

  // 1) Add question-pattern keys based on content
  if (/温度|℃|°c|加热|水浴|40℃|100℃|110℃/.test(title + answer)) {
    QUESTION_PATTERNS.temp.forEach(p => { if (!existingKeys.has(p)) newKeys.push(p); });
  }
  if (/为什么|因为|原理|机理|原因|由于/.test(answer)) {
    QUESTION_PATTERNS.why.forEach(p => { if (!existingKeys.has(p)) newKeys.push(p); });
  }
  if (/步骤|操作|方法|怎么|如何|流程/.test(title + answer)) {
    QUESTION_PATTERNS.how.forEach(p => { if (!existingKeys.has(p)) newKeys.push(p); });
  }
  if (/多少|用量|浓度|质量|几克|几mol/.test(title + answer)) {
    QUESTION_PATTERNS.quant.forEach(p => { if (!existingKeys.has(p)) newKeys.push(p); });
  }

  // 2) Add compound name variants
  for (const [chem, variants] of Object.entries(CHEM_VARIANTS)) {
    if ((title + answer).includes(chem.toLowerCase())) {
      variants.forEach(v => { if (!existingKeys.has(v)) newKeys.push(v); });
    }
  }

  // 3) Add operation variants
  for (const [op, variants] of Object.entries(OP_VARIANTS)) {
    if ((title + answer).includes(op)) {
      variants.forEach(v => { if (!existingKeys.has(v)) newKeys.push(v); });
    }
  }

  // 4) Add compound phrases: topic words + question words
  const topicWords = title.replace(/[，,、\s]+/g, ' ').split(' ').filter(w => w.length >= 2 && !/[的了吗呢]/.test(w));
  if (topicWords.length >= 2) {
    const phrase = topicWords.slice(0, 3).join('');
    if (phrase.length >= 4 && !existingKeys.has(phrase)) newKeys.push(phrase);
  }

  // 5) Extract key noun phrases from answer (3-6 char Chinese runs)
  const cnRuns = answer.match(/[一-龥]{3,6}/g) || [];
  for (const run of cnRuns.slice(0, 8)) {
    if (!existingKeys.has(run) && !/[的了吗呢吧啊呀]/.test(run)) {
      newKeys.push(run);
    }
  }

  if (newKeys.length > 0) {
    entry.keys = [...(entry.keys || []), ...newKeys.slice(0, 10)];
    enriched++;
  }
}

// Write enriched FAQ
fs.writeFileSync(
  path.join(__dirname, '..', 'data', 'faq_unified.json'),
  JSON.stringify(FAQ, null, 2),
  'utf8'
);

console.log('Enriched ' + enriched + ' out of ' + FAQ.length + ' FAQ entries');
console.log('Sample enriched entries:');

// Show a few examples
const samples = FAQ.filter(e => e.keys.length > 12).slice(0, 3);
for (const s of samples) {
  console.log('  ' + s.title + ': ' + s.keys.length + ' keys (was ' + (s.keys.length - 10) + '+)');
}
