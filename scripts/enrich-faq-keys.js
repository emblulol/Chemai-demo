/**
 * enrich-faq-keys.js
 * ⚠ DEPRECATED (v43): 该脚本向 keys 机械注入问法模板/同义词/泛词，是关键词噪声源。
 * 运行版 assistant.html 已改用语料驱动学术词表 _archive/data_dev/academic_lexicon.json。
 * 不要再次运行本脚本，否则会重新注入噪声。见 scripts/lib-assistant-faq.js。
 * Intelligently expands `keys` and `ents` fields in faq_unified.json
 * using content-aware rule-based generation.
 * Target: 10-25 keys per entry (up from avg 5.9), expanded entity lists.
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', 'faq_unified.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'faq_unified.json');

// ── Question word patterns ──────────────────────────────────────────
const Q_WORDS = {
  operational: ['怎么做', '如何操作', '怎样操作', '操作步骤', '实验流程'],
  explanatory: ['为什么', '原因是什么', '原理是什么'],
  definitional: ['是什么', '什么是', '什么叫', '定义是什么'],
  quantitative: ['是多少', '数值是多少', '具体数值'],
  comparative: ['有什么区别', '有什么不同', '哪个更好'],
  availability: ['有哪些', '都有哪些', '哪几种'],
};

// ── Synonym groups (chemical terminology) ───────────────────────────
const SYNONYMS = {
  '制备': ['合成', '制作'],
  '步骤': ['流程', '操作流程'],
  '方程式': ['反应式', '化学方程式', '反应方程式'],
  '温度': ['多少度', '加热温度'],
  '颜色': ['什么颜色', '外观'],
  '产率': ['产量', '收率'],
  '配位': ['络合'],
  '配合物': ['络合物'],
  '晶体': ['结晶'],
  '安全': ['危险', '防护'],
  '废液': ['废物', '废水', '废液处理'],
};

// ── Entity expansion: Chinese <-> English/formula ───────────────────
const ENTITY_MAP = {
  '三草酸合铁酸钾': ['K3[Fe(C2O4)3]·3H2O', '三草酸合铁(III)酸钾', 'K3[Fe(C2O4)3]', 'Potassium tris(oxalato)ferrate(III) trihydrate'],
  '草酸': ['H2C2O4', '乙二酸', 'H2C2O4·2H2O', '草酸二水合物'],
  '草酸钾': ['K2C2O4', 'K2C2O4·H2O', '草酸钾一水合物'],
  '草酸根': ['C2O4²⁻', 'oxalate', '草酸根离子'],
  '过氧化氢': ['H2O2', '双氧水', 'hydrogen peroxide'],
  '摩尔盐': ['Mohr盐', '莫尔盐', '硫酸亚铁铵', '(NH4)2Fe(SO4)2·6H2O', "Mohr's salt"],
  '硫酸亚铁': ['FeSO4', '绿矾', 'FeSO4·7H2O'],
  '高锰酸钾': ['KMnO4', 'potassium permanganate'],
  '氢氧化铁': ['Fe(OH)3'],
  '草酸亚铁': ['FeC2O4', 'FeC2O4·2H2O', '草酸亚铁二水合物'],
  '铁氰化钾': ['K3[Fe(CN)6]', '赤血盐', 'potassium ferricyanide'],
  '硫氰酸钾': ['KSCN', 'potassium thiocyanate'],
  '维尔纳': ['Alfred Werner', 'Werner'],
  '普鲁士蓝': ['Prussian blue', 'Fe4[Fe(CN)6]3', '柏林蓝', '滕氏蓝'],
  '柠檬酸铁铵': ['ferric ammonium citrate', '柠檬酸铁(III)铵'],
  '乙醇': ['C2H5OH', '酒精', 'ethanol'],
  '氧化铁': ['Fe2O3', '三氧化二铁'],
  '二草酸合铜酸钾': ['K2[Cu(C2O4)2]', 'K2[Cu(C2O4)2]·2H2O'],
  '顺铂': ['cisplatin', 'cis-[PtCl2(NH3)2]'],
  '二氧化钛': ['TiO2', 'titanium dioxide'],
  '丙酮': ['CH3COCH3', 'acetone'],
  '乙醚': ['C2H5OC2H5', 'diethyl ether'],
  '氯化钴': ['CoCl3'],
  '氨': ['NH3', '氨气'],
  '六氨合钴': ['[Co(NH3)6]Cl3', '六氨合钴(III)氯化物'],
  '配位化合物': ['配合物', '络合物', 'coordination compound'],
  '配体': ['配位体', 'ligand'],
  '中心离子': ['central ion', '中心原子'],
  '配位数': ['coordination number'],
  '光谱化学序列': ['spectrochemical series'],
  '稳定常数': ['Kstab', 'formation constant', 'Kf'],
  '氟化铵': ['NH4F'],
  '晶体场': ['crystal field theory', 'CFT', '晶体场理论'],
  '配位场': ['ligand field theory', 'LFT', '配位场理论'],
  '光化学': ['photochemistry', '光化学反应'],
  '草酸铁': ['Fe2(C2O4)3'],
};

// ── Topic detection helpers ─────────────────────────────────────────
function isOperational(entry) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  return /步骤|操作|怎么做|如何做|制备|合成|流程|规范|操作流程/.test(text) ||
    /实验操作|合成制备/.test(entry.subfield);
}

function isExplanatory(entry) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  return /为什么|为何|原因|原理|机理|解释|因为/.test(text) ||
    /反应原理|高等理论|配位化学理论/.test(entry.subfield);
}

function isDefinitional(entry) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  return /是什么|定义|概念|什么叫|什么是/.test(text) ||
    /是指|指的是|即|定义为/.test(entry.answer + (entry.detail || '')) ||
    /结构表征|配位化学理论/.test(entry.subfield);
}

function isQuantitative(entry) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  return /多少|数值|数据|计算|浓度|用量|产率|收率|温度值|时间值/.test(text) ||
    /分析测定|热分析/.test(entry.subfield);
}

function isComparative(entry) {
  const text = entry.title + entry.q;
  return /对比|比较|区别|不同|vs|优于|哪个好|哪种/.test(text);
}

// ── Rule A: Smart question word variants ────────────────────────────
function addQuestionVariants(entry, keySet) {
  if (isOperational(entry)) {
    for (const w of Q_WORDS.operational) keySet.add(w);
  }
  if (isExplanatory(entry)) {
    for (const w of Q_WORDS.explanatory) keySet.add(w);
  }
  if (isDefinitional(entry)) {
    for (const w of Q_WORDS.definitional) keySet.add(w);
  }
  if (isQuantitative(entry)) {
    for (const w of Q_WORDS.quantitative) keySet.add(w);
  }
  if (isComparative(entry)) {
    for (const w of Q_WORDS.comparative) keySet.add(w);
  }
  if (isDefinitional(entry) || /有哪些|哪几种|种类|分类/.test(entry.title + entry.q)) {
    for (const w of Q_WORDS.availability) keySet.add(w);
  }
}

// ── Rule B: Targeted synonym expansion ──────────────────────────────
function addSynonyms(entry, keySet) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  for (const [base, syns] of Object.entries(SYNONYMS)) {
    if (text.includes(base)) {
      for (const s of syns) {
        // Only add if the synonym is actually relevant (mentioned in text)
        if (text.includes(s) || text.includes(base)) {
          keySet.add(s);
        }
      }
    }
    // Also check if synonym is in the text (reverse direction)
    for (const s of syns) {
      if (text.includes(s)) {
        keySet.add(base);
        for (const s2 of syns) {
          keySet.add(s2);
        }
      }
    }
  }
}

// ── Rule C: Entity enrichment ───────────────────────────────────────
function expandEntityList(entry) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  const ents = new Set((entry.ents || []).filter(e => e && e.length >= 2));

  for (const [key, expansions] of Object.entries(ENTITY_MAP)) {
    if (text.includes(key)) {
      for (const exp of expansions) {
        ents.add(exp);
      }
    }
    // Reverse: if any expansion is in text, add the key and all expansions
    for (const exp of expansions) {
      if (text.includes(exp)) {
        ents.add(key);
        for (const e of expansions) {
          ents.add(e);
        }
      }
    }
  }

  // Extract meaningful compound nouns from title (2-4 char Chinese substrings)
  // Strategy: find the longest meaningful substrings, not all ngrams
  const titleChinese = (entry.title || '').replace(/[^一-鿿]/g, '');
  // Keep the full Chinese title as a phrase if short enough
  const stopPhrases = new Set(['什么','怎么','为什么','多少','哪些','如何','怎样','能否','可以','操作','步骤','问题','怎么办','是什么','怎么做','为什么','是多少','有哪些','好不好','能不能','可不可以','如何做','怎样做','叫什么','称为','所谓','这一','那个','这个','什么','内容','摘要','归纳','总结']);
  if (titleChinese.length >= 2 && titleChinese.length <= 15) {
    ents.add(titleChinese);
  }
  // Extract meaningful segments by splitting on common connectors/function words
  const segments = titleChinese.split(/(?:与|和|及|或|的|之|对|在|中|用|以|为|是|有|不|含)/);
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 12 && !stopPhrases.has(seg)) {
      ents.add(seg);
    }
  }

  // Clean: remove pure numbers, single chars, obvious noise
  return [...ents].filter(e => {
    if (!e || e.length < 2 || e.length > 80) return false;
    if (/^\d+$/.test(e)) return false;
    if (/^[A-Z][a-z]?$/.test(e) && e.length <= 2) return false; // single element symbol
    if (/^(的|了|在|和|与|或|是|不|这|那)$/.test(e)) return false;
    return true;
  });
}

// ── Rule D: Cross-reference enrichment ──────────────────────────────
function addCrossReferences(entry, keySet) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');

  const xrefRules = [
    { test: /H2O2|过氧化氢|双氧水/, add: ['H2O2', '过氧化氢', '双氧水', '氧化剂'] },
    { test: /温度|水浴|加热|℃/, add: ['温度控制', '水浴加热', '加热方式'] },
    { test: /乙醇|酒精|C2H5OH/, add: ['乙醇', '酒精', '溶剂替换法'] },
    { test: /草酸|C2O4|oxalate/, add: ['草酸', '草酸根'] },
    { test: /KMnO4|高锰酸钾|滴定/, add: ['高锰酸钾', 'KMnO4', '氧化还原滴定'] },
    { test: /配位|配合物|络合/, add: ['配位化学', '配合物', '配位键'] },
    { test: /结晶|晶体|结晶水|单斜/, add: ['结晶', '晶体', '晶系'] },
    { test: /光[照化学敏]|LMCT|光解/, add: ['光化学', '光照', '光解'] },
    { test: /蓝晒|晒蓝|cyanotype/, add: ['蓝晒', '蓝晒法', '感光'] },
    { test: /安全|危险|[中泄]毒|LD50/, add: ['安全', '危险化学品', '防护措施'] },
    { test: /磁[性矩化]|[古G]埃/, add: ['磁性', '磁矩', '磁化率'] },
    { test: /热重|TG|DSC|热分解|失重/, add: ['热重分析', '热分解', 'TG-DSC'] },
    { test: /KSCN|硫氰酸钾/, add: ['KSCN', '硫氰酸钾', '检测Fe³⁺', '血红色'] },
    { test: /产率|产量|收率/, add: ['产率计算', '理论产量', '实际产量'] },
    { test: /废液|废水|废物/, add: ['废液处理', '实验室废物', '排放标准'] },
    { test: /命名|名称|IUPAC/, add: ['命名规则', 'IUPAC命名', '系统命名'] },
    { test: /[颜翠绿红棕血红]色/, add: ['外观颜色', '晶体颜色', '什么颜色'] },
    { test: /pH|酸[碱性]/, add: ['pH', '酸碱性', 'pH值'] },
    { test: /红外|IR|特征峰/, add: ['红外光谱', '特征峰', 'IR'] },
    { test: /紫外|UV-Vis|吸收峰/, add: ['紫外光谱', 'UV-Vis', '吸收峰'] },
    { test: /稳定常数|Kstab|Kf/, add: ['稳定常数', 'Kstab', '配位平衡'] },
    { test: /晶体场|CFT|d轨道|分裂能/, add: ['晶体场理论', 'CFT', 'd轨道分裂'] },
    { test: /溶解度|溶[于解]/, add: ['溶解度', '溶解性', '水溶性'] },
    { test: /Fe[²³⁺]|铁[盐离]/, add: ['铁', '铁离子'] },
  ];

  for (const rule of xrefRules) {
    if (rule.test.test(text)) {
      for (const word of rule.add) {
        keySet.add(word);
      }
    }
  }

  // Step-specific cross-references
  if (/第一[步阶段]|第[1一][步阶段]|沉淀.*草酸亚铁|草酸亚铁.*制备/.test(text)) {
    keySet.add('第一步'); keySet.add('草酸亚铁'); keySet.add('沉淀反应');
    keySet.add('FeC2O4'); keySet.add('摩尔盐'); keySet.add('硫酸亚铁铵');
  }
  if (/第二[步阶段]|第[2二][步阶段]|氧化.*Fe|H2O2.*氧化/.test(text)) {
    keySet.add('第二步'); keySet.add('H2O2'); keySet.add('氧化反应');
    keySet.add('过氧化氢'); keySet.add('水浴加热'); keySet.add('40度');
  }
  if (/第三[步阶段]|第[3三][步阶段]|配位.*草酸|溶解.*氢氧化铁/.test(text)) {
    keySet.add('第三步'); keySet.add('配位反应'); keySet.add('草酸');
    keySet.add('微沸'); keySet.add('溶解氢氧化铁');
  }
  if (/第四[步阶段]|第[4四][步阶段]|结晶.*乙醇|溶剂替换/.test(text)) {
    keySet.add('第四步'); keySet.add('结晶'); keySet.add('溶剂替换');
    keySet.add('乙醇'); keySet.add('抽滤'); keySet.add('干燥');
  }
}

// ── Rule E: Context-aware keyword generation ────────────────────────
function addContextKeywords(entry, keySet) {
  const text = entry.title + entry.q + entry.answer + (entry.detail || '');
  const title = entry.title || '';
  const q = entry.q || '';

  // Add title as-is (it's often a good search term)
  if (title.length <= 30) {
    keySet.add(title);
  }

  // Add q as-is if it's short enough
  if (q.length <= 40 && q.length >= 2) {
    keySet.add(q);
  }

  // Generate natural question from the main title concept
  // Extract the core topic from title (before any parens or dashes)
  const coreTopic = title.split(/[（(]|\s*[-–—]\s*/)[0].trim();
  // Skip if title is already a question
  const isAlreadyQuestion = /[怎么|如何|什么|为什么|多少|哪些|何时|是否|能否|可以|能|会]/.test(coreTopic) &&
    (/[？?吗呢啊]/.test(coreTopic) || /怎么[算做办]|如何[做写操作]|为什么|多少|哪些/.test(coreTopic));
  if (coreTopic.length >= 2 && coreTopic.length <= 20 && !isAlreadyQuestion) {
    keySet.add(coreTopic + '是什么');
    if (isOperational(entry)) {
      keySet.add(coreTopic + '怎么做');
      keySet.add(coreTopic + '步骤');
    }
    if (isExplanatory(entry)) {
      keySet.add(coreTopic + '的原因');
    }
  }

  // If answer contains definition-like language
  if (/是指|指的是|定义为|即/.test(entry.answer)) {
    keySet.add('是什么');
    keySet.add('什么叫');
    keySet.add('定义');
  }

  // Extract key chemical terms from title as standalone keys
  const chemPatterns = [
    /三草酸合铁/, /二草酸合铜/, /六氨合钴/, /普鲁士蓝/, /滕氏蓝/,
    /蓝晒/, /顺铂/, /莫尔盐|摩尔盐/, /维尔纳/, /配位/, /络合/,
    /晶体场|配位场/, /光谱化学/, /朗伯比尔/, /古埃/, /草酸/,
    /过氧化氢|双氧水/, /高锰酸钾/, /氢氧化铁/, /氢氧化钠/,
    /硫酸亚铁/, /氯化铁/, /氧化铁/, /二氧化钛/, /柠檬酸铁/,
    /铁氰化钾|硫氰酸钾/, /氟化铵/, /草酸根/, /Ziegler|Natta/,
    /Jahn|Teller/, /光化学/, /光敏/, /热重|TG|DSC/,
    /KMnO4/, /H2O2/, /KSCN/, /Fe/, /XRD/,
  ];
  for (const pat of chemPatterns) {
    const m = title.match(pat);
    if (m) keySet.add(m[0]);
  }

  // Add key formula keywords from text (only well-formed ones)
  const fullFormulas = text.match(/\b[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+(?:·\d*H\d*O)?\b/g) || [];
  for (const f of fullFormulas) {
    if (f.length >= 3 && f.length <= 40 && !/^(III|IV|II|VI)$/.test(f)) {
      keySet.add(f);
    }
  }
}

// ── Clean key post-processing ────────────────────────────────────────
function cleanKeys(keys) {
  // Common stop words that shouldn't be standalone keys
  const stopKeys = new Set([
    '的', '了', '在', '和', '与', '或', '是', '不', '这', '那',
    '一', '个', '有', '会', '可以', '需要', '应该', '必须',
    '因为', '所以', '但是', '如果', '虽然', '而且', '然后',
    '之后', '之前', '以后', '之前', '什么', '怎么', '哪',
    '呢', '吗', '吧', '啊', '都', '也', '就', '才', '还',
    '又', '再', '把', '被', '让', '给', '对', '从', '到',
    '向', '跟', '同', '比', '为', '以', '用', '之', '其',
    '中', '上', '下', '内', '外', '前', '后', '左', '右',
    '大', '小', '多', '少', '高', '低', '新', '旧', '好',
    '坏', '第', '第', '含', '无', '非', '每', '各', '某',
    '本', '该', '此', '者', '所', '可', '能', '要', '将',
    '已', '正', '在', '着', '过', '得', '地', '中', '等',
  ]);

  return keys
    .filter(k => typeof k === 'string' && k.trim().length >= 2 && k.length <= 50)
    .filter(k => !stopKeys.has(k))
    .filter(k => !/^\d+$/.test(k))                  // pure numbers
    .filter(k => !/^[A-Z][a-z]?$/.test(k))          // single element symbols
    .filter(k => !/^(III|IV|II|VI|VII|VIII)$/i.test(k))  // oxidation states as standalone
    .filter(k => !/^[A-Z][a-z]?[A-Z][a-z]?$/.test(k) && !/^[A-Z][a-z]?\d$/.test(k)) // 2-char element combos
    .filter(k => !/^[A-Z][a-z]?\d+$/.test(k))       // single element with number
    // Filter short chemical fragments that aren't real formulas
    .filter(k => {
      if (k.length <= 3 && /^[A-Z][a-z]?[A-Z]?[a-z]?$/.test(k)) {
        // Must match a known chemical entity or formula
        const knownShort = new Set(['Fe', 'Cu', 'Zn', 'Mn', 'Cr', 'Co', 'Ni', 'Ag', 'Pt', 'Ti', 'H2O', 'CO2', 'NH3', 'HCl', 'NaOH', 'KBr', 'NaCl', 'C2H5OH']);
        return knownShort.has(k);
      }
      return true;
    })
    // Deduplicate (case-insensitive)
    .filter((k, i, arr) => {
      const lower = k.toLowerCase();
      return arr.findIndex(x => x.toLowerCase() === lower) === i;
    });
}

// ── Main enrichment ─────────────────────────────────────────────────
function enrichEntry(entry) {
  const keySet = new Set(entry.keys || []);

  // Apply all rules
  addQuestionVariants(entry, keySet);
  addSynonyms(entry, keySet);
  addCrossReferences(entry, keySet);
  addContextKeywords(entry, keySet);

  // Enrich entities
  const enrichedEnts = expandEntityList(entry);

  // Clean and deduplicate keys
  let finalKeys = cleanKeys([...keySet]);

  // ── Smart trimming: if too many, prioritize ────────────────────────
  // Score keys: original keys first, then question patterns, then chemical terms
  const origSet = new Set(entry.keys || []);
  const scored = finalKeys.map(k => {
    let score = 0;
    if (origSet.has(k)) score += 100;           // keep originals
    if (k.length >= 4 && /[一-鿿]/.test(k)) score += 30;  // Chinese content words
    if (/[怎么做|如何|怎样|为什么|为何|是什么|什么叫|多少|哪些|能不能|是什么]/.test(k)) score += 20;
    if (/[A-Z]\d/.test(k) || /[¹²³⁴⁵⁶⁷⁸⁹⁰]/.test(k)) score += 15;  // chemical formulas
    if (k.length >= 5) score += 5;               // longer = more specific
    return { key: k, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // Target: 12-25 keys (richer than before but not bloated)
  const TARGET_MAX = 25;
  const TARGET_MIN = 10;
  if (scored.length > TARGET_MAX) {
    finalKeys = scored.slice(0, TARGET_MAX).map(s => s.key);
  }
  // If under minimum, that's ok if we genuinely can't generate more
  // (but we always have at least the originals + question patterns)

  return {
    ...entry,
    keys: finalKeys,
    ents: enrichedEnts,
  };
}

// ── Main ────────────────────────────────────────────────────────────
function main() {
  console.log('Reading', INPUT, '...');
  let raw = fs.readFileSync(INPUT, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
    console.log('  (stripped BOM)');
  }
  const data = JSON.parse(raw);
  console.log('Total entries:', data.length);

  // Before stats
  const beforeKeys = data.map(e => (e.keys || []).length);
  const beforeEnts = data.map(e => (e.ents || []).length);
  console.log('Before - Avg keys:', (beforeKeys.reduce((a, b) => a + b, 0) / data.length).toFixed(1),
    '| Avg ents:', (beforeEnts.reduce((a, b) => a + b, 0) / data.length).toFixed(1));

  // Enrich
  const enriched = data.map((entry, i) => {
    const result = enrichEntry(entry);
    if ((i + 1) % 100 === 0) {
      console.log('  Processed', i + 1, '/', data.length, '...');
    }
    return result;
  });

  // After stats
  const afterKeys = enriched.map(e => e.keys.length);
  const afterEnts = enriched.map(e => e.ents.length);
  console.log('After  - Avg keys:', (afterKeys.reduce((a, b) => a + b, 0) / data.length).toFixed(1),
    '| Avg ents:', (afterEnts.reduce((a, b) => a + b, 0) / data.length).toFixed(1));

  // Distribution
  const dist = {};
  afterKeys.forEach(k => { dist[k] = (dist[k] || 0) + 1; });
  console.log('Key distribution after enrichment:');
  Object.entries(dist)
    .sort((a, b) => +a[0] - +b[0])
    .forEach(([k, v]) => console.log('  ' + k + ' keys: ' + v + ' entries'));

  // Entries still low
  const lowKeys = enriched.filter(e => e.keys.length < 8);
  console.log('Entries with <8 keys:', lowKeys.length);

  // ── Validation ──
  console.log('\n── Validation ──');
  console.log('Total entries:', enriched.length, '(expected 700)');
  console.log('All entries have keys:', enriched.every(e => Array.isArray(e.keys)));
  console.log('All entries have ents:', enriched.every(e => Array.isArray(e.ents)));
  console.log('All original fields preserved:', Object.keys(data[0]).every(f => f in enriched[0]));
  console.log('Answers changed:', data.filter((e, i) => e.answer !== enriched[i].answer).length, '(should be 0)');
  console.log('Titles changed:', data.filter((e, i) => e.title !== enriched[i].title).length, '(should be 0)');
  console.log('Details changed:', data.filter((e, i) => e.detail !== enriched[i].detail).length, '(should be 0)');

  // Dedup check
  let dupCount = 0;
  for (const e of enriched) {
    const lowers = e.keys.map(k => k.toLowerCase());
    if (new Set(lowers).size !== lowers.length) dupCount++;
  }
  console.log('Entries with duplicate keys:', dupCount, '(should be 0)');

  // Question pattern coverage
  const allKeys = enriched.flatMap(e => e.keys);
  const patterns = ['怎么做', '为什么', '是什么', '方程式', '如何', '怎样', '多少', '有哪些', '能不能', '什么叫', '为何', '原因', '原理', '操作步骤'];
  console.log('\nQuestion pattern coverage:');
  for (const p of patterns) {
    console.log('  "' + p + '": ' + allKeys.filter(k => k.includes(p)).length);
  }

  console.log('\nMin keys:', Math.min(...afterKeys), '| Max keys:', Math.max(...afterKeys));
  console.log('Min ents:', Math.min(...afterEnts), '| Max ents:', Math.max(...afterEnts));

  // Write
  console.log('\nWriting to', OUTPUT, '...');
  fs.writeFileSync(OUTPUT, JSON.stringify(enriched, null, 2), 'utf8');
  console.log('Done!');

  // Sample diff
  console.log('\n── Sample key count changes ──');
  for (let i = 0; i < 15; i++) {
    console.log('  [' + i + '] ' + enriched[i].title + ': ' + beforeKeys[i] + ' -> ' + afterKeys[i] + ' keys');
  }
  console.log('  ...');
  for (let i = data.length - 10; i < data.length; i++) {
    console.log('  [' + i + '] ' + enriched[i].title + ': ' + beforeKeys[i] + ' -> ' + afterKeys[i] + ' keys');
  }
}

main();
