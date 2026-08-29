'use strict';
/**
 * v43 LLM 审定清单生成器（不写回 HTML，只产出 manifest）
 *
 * 对 52 条 keys<3 条目补充学术词（优先取自 _archive/data_dev/academic_lexicon.json），
 * 对 2 条 tierB 条目做条件删除。输出:
 *   Agent工作区/Agent-报告/v43_llm_manifest.json  → {index, new_keys}
 *
 * 用法: node scripts/gen-llm-manifest.js
 */

const fs = require('fs');
const path = require('path');
const { readFAQRuntime } = require('./lib-assistant-faq.js');

const OUT = path.join(__dirname, '..', 'Agent工作区', 'Agent-报告', 'v43_llm_manifest.json');

// ---- 学术词白名单（供校验/提示，非强制） ----
let rawLex = fs.readFileSync(path.join(__dirname, '..', 'data', 'academic_lexicon.json'), 'utf8');
if (rawLex.charCodeAt(0) === 0xFEFF) rawLex = rawLex.slice(1);
const lexicon = JSON.parse(rawLex);
const canonSet = new Set((lexicon.flat.canonical_terms || []).map(s => s.toLowerCase()));
const entitySet = new Set((lexicon.flat.entity_terms || []).map(s => s.toLowerCase()));

// ---- 低 key 条目学术词补充（index → 追加词） ----
const ADDITIONS = {
  85: ["莫尔盐", "硫酸亚铁铵", "复盐", "储存", "变质"],
  94: ["过氧化氢", "双氧水", "泄漏处理", "急救", "防护手套"],
  192: ["溶度积", "草酸亚铁", "沉淀溶解", "Ksp"],
  244: ["中心离子", "配体", "配位数", "配位化合物"],
  245: ["双齿配体", "螯合", "草酸根", "配位原子"],
  250: ["氨水", "氢氧化铁", "配位反应", "溶解"],
  251: ["光化学", "量子产率", "光敏性", "格罗图斯"],
  252: ["通风橱", "个人防护", "安全规程", "通风"],
  256: ["磁矩", "高自旋", "自旋公式", "电子排布", "未成对电子"],
  257: ["反应级数", "速率方程", "浓度", "速率常数", "动力学"],
  262: ["个人防护", "安全规程", "通风橱", "废液处理"],
  263: ["草酸根", "双齿配体", "结构", "配位原子"],
  264: ["乙醇", "溶剂替换法", "结晶", "用量", "10 mL乙醇"],
  267: ["MOF", "金属有机框架", "配位聚合物", "应用"],
  268: ["维尔纳", "配位理论", "主价", "副价", "配位数"],
  269: ["搅拌", "滴加", "水浴", "操作"],
  271: ["蓝晒", "避光", "光敏性", "感光", "涂布"],
  272: ["故障排查", "产率", "杂质", "结晶条件"],
  276: ["急救", "洗眼器", "事故处理", "应急处理"],
  277: ["稳定常数", "累积稳定常数", "平衡常数", "Kf"],
  278: ["CFSE", "高自旋", "晶体场理论", "分裂能", "d⁵"],
  280: ["煮沸", "微沸", "过氧化氢", "H₂O₂"],
  283: ["草酸", "0.5 mol/L", "H₂C₂O₄", "配制", "溶液"],
  284: ["pH", "试纸", "酸碱性", "测定"],
  285: ["光照", "紫外光", "光化学", "量子产率", "条件"],
  287: ["草酸钾", "K₂C₂O₄", "配位剂", "滴加", "原因"],
  290: ["酞菁", "酞菁铜", "配位化合物", "平面结构", "应用"],
  293: ["评分标准", "考核", "教学评价", "实验报告"],
  294: ["颜色", "d-d跃迁", "互补色", "吸收光谱", "呈色"],
  330: ["pH", "氧化", "Fe(OH)₃", "水解", "配位"],
  332: ["量子产率", "光化学", "LMCT", "光解", "数值"],
  363: ["教学目标", "知识目标", "配位化学", "概念"],
  364: ["教学目标", "能力目标", "操作技能", "素养目标"],
  412: ["产率", "草酸", "配位反应", "Fe(OH)₃", "溶解"],
  413: ["结晶条件", "产率", "结晶", "过饱和度", "乙醇"],
  417: ["结晶", "过饱和度", "爆发成核", "晶体质量", "晶形"],
  418: ["温度", "结晶", "晶体质量", "晶形"],
  419: ["结晶", "静置", "晶形", "晶体质量", "扰动"],
  423: ["颜色", "晶形", "杂质", "诊断", "翠绿色"],
  425: ["颜色", "杂质", "翠绿色", "诊断", "光解"],
  427: ["水浴锅", "设备故障", "加热", "处理"],
  428: ["水浴锅", "设备故障", "漏水", "处理"],
  431: ["草酸", "潮解", "变质", "储存", "解决"],
  434: ["乙醇", "浓度", "溶剂替换", "结晶"],
  435: ["结晶水", "配位水", "晶格水", "热分解", "辨析"],
  436: ["配位数", "双齿配体", "配位原子", "辨析"],
  437: ["草酸根", "双齿配体", "螯合", "配位原子", "辨析"],
  439: ["滕氏蓝", "普鲁士蓝", "IVCT", "铁氰化钾", "辨析"],
  442: ["配合物", "电离", "稳定常数", "解离平衡", "辨析"],
  443: ["草酸根", "弱场配体", "光谱化学序列", "高自旋", "辨析"],
  444: ["产率", "纯度", "杂质", "误差", "辨析"],
  457: ["草酸", "酸效应", "配位平衡", "过量", "后果"]
};

// ---- tierB 条件调整（index → 删除的 key） ----
const REMOVALS = {
  87: ["颜色"],   // 铁氰化钾安全条目，颜色非主题
  233: ["原理"]   // 实验报告结构条目，裸"原理"无区分度
};

const CAP = 15;

function main() {
  const faq = readFAQRuntime();
  const changes = [];
  const stats = { added: 0, removed: 0, fromLexicon: 0 };

  for (const idxStr of Object.keys(ADDITIONS)) {
    const i = parseInt(idxStr, 10);
    const f = faq[i];
    if (!f) throw new Error('索引越界: ' + i);
    const existing = f.keys || [];
    const additions = ADDITIONS[idxStr];
    const merged = [];
    const seen = new Set();
    for (const k of [...existing, ...additions]) {
      const d = k.toLowerCase();
      if (seen.has(d)) continue;
      seen.add(d);
      merged.push(k);
      if (additions.includes(k)) { stats.added++; if (canonSet.has(d)) stats.fromLexicon++; }
    }
    changes.push({ index: i, title: f.title, new_keys: merged.slice(0, CAP) });
  }

  for (const idxStr of Object.keys(REMOVALS)) {
    const i = parseInt(idxStr, 10);
    const f = faq[i];
    if (!f) throw new Error('索引越界: ' + i);
    const removeSet = new Set(REMOVALS[idxStr].map(s => s.toLowerCase()));
    const kept = (f.keys || []).filter(k => !removeSet.has(k.toLowerCase()));
    stats.removed += (f.keys || []).length - kept.length;
    changes.push({ index: i, title: f.title, new_keys: kept.slice(0, CAP) });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(changes, null, 2), 'utf8');

  console.log('=== LLM 审定清单 ===');
  console.log('补充条目: ' + Object.keys(ADDITIONS).length + ' | 调整条目: ' + Object.keys(REMOVALS).length);
  console.log('新增 key 数: ' + stats.added + ' | 其中来自词表: ' + stats.fromLexicon + ' | 删除 key: ' + stats.removed);
  // 校验：所有处理后 keys≥3
  const faqAfter = faq.map(f => ({ ...f }));
  for (const c of changes) faqAfter[c.index] = { ...faqAfter[c.index], keys: c.new_keys };
  const low = faqAfter.filter(f => (f.keys || []).length < 3).length;
  console.log('处理后 keys<3 条目: ' + low);
  console.log('输出: ' + OUT);
}

main();
