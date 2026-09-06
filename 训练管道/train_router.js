'use strict';
/**
 * train_router.js — 监督学习"问题→条目"相关性排序器（离线训练，部署外）。
 *
 * 思路（结合 ML 讲义）：把 matchFAQ 的手工权重换成"从标注样本学出来的权重"。
 *   特征(工程化) → 训练集(faq_verify + 换问法变体 as gold；条目显著 key 作弱监督正样本；同子域硬负样本+异域随机负样本)
 *   → 带 L2 正则的 logistic 回归（train/val 切分、early-stopping 防过拟合——v87 MLP 输在样本少未正则）
 *   → 输出 权重 w,b 烘焙到 scripts/route-weights.js；运行时只做 w·features(Q,E)+b（无推理后端）。
 * 用法: node 训练管道/train_router.js
 * 输出: 训练/验证 Precision/Recall/F1 + scripts/route-weights.js
 */
const path = require('path');
const fs = require('fs');
const { readFAQRuntime } = require('../scripts/lib-assistant-faq.js');
const ROUTE = require('../scripts/route-local.js');

const ROOT = path.join(__dirname, '..');
const faq = readFAQRuntime();
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions_bank.json'), 'utf8').replace(/^﻿/, '')).questions;
const adv = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'queries_adversarial.json'), 'utf8').replace(/^﻿/, ''));

const titleIndex = new Map();
faq.forEach((f) => { if (f.title) titleIndex.set(f.title, f); });

// ==== 特征向量：把 matchFAQ 的信号变成"可学习"的稀疏特征（并归一化）====
// 复用 route-local 的 NORM/FIXTYPO/classifyDomain；打分逻辑逐字复刻 scoreEntry 取原始计数。
const IDF_PENALTY = { '实验':0.4,'制备':0.5,'化学':0.5,'操作':0.6,'步骤':0.6,'原理':0.5,'方法':0.6,'分析':0.6,'测定':0.6,'研究':0.7,'反应':0.5,'产物':0.6,'合成':0.5,'配合物':0.6 };
const GENERIC_KEYS = new Set(['实验','制备','化学','操作','步骤','原理','方法','分析','测定','研究','反应','产物','合成','配合物','氧化','温度','产率','沉淀','结晶','过滤','洗涤','烘干','干燥','避光','加热','冷却','溶解','静置','时间','颜色','现象','安全','影响','原因','过程','条件','用量','浓度','作用','顺序','终点','检验','验证','水浴','搅拌','生成','分解','方程式','反应方程式','化学方程式','为什么','为何','如何','怎么','怎样','怎么样','什么','是否','多少','哪些','哪个','哪儿','哪里','几','吗','呢','怎么算','怎么求','怎么计算','怎么测定','怎么数','怎么办','怎么处理','怎么判断','怎么区分','怎么表示','怎么验','咋算','到底咋算','怎么推导','怎么理解','怎么解释','怎么选','怎么配','怎么加','为什么会','是什么','是怎么','是不是','是几','是啥']);
const CHEM_NOUN = new Set(['草酸','莫尔盐','摩尔盐','乙醇','过氧化氢','铁氰化钾','硫酸亚铁','草酸钾','草酸根','三草酸','氢氧化铁','硫酸','氨水','双氧水','配离子','酸根','草酸氢钾','草酸亚铁']);
const OP_RE = /(终点|判断|速度|距离|多久|何时|顺序|先后|洗涤|烘干|冷却|加热|过滤|抽滤|水浴|暴沸|防止|避免|补救|滴加|用量|比例|操作|步骤|干燥|称量|量取|检验|如何判断|怎么判断)/;
const STEP_TEMPLATE_RE = /(第[一二三四五六七八九十百\d]+步|深度解析|反应机理|热力学与动力学|氧化电位)/;
const call = (f, args) => f.apply(null, args);
function isChemKey(k, nk) { return /[a-z0-9]/.test(nk || ROUTE.NORM(k)) || CHEM_NOUN.has(k); }

// 返回特征数组（长度固定）。所有计数做量纲缩放（PDF02 scaling），避免未缩放造成偏差。
function feat(nq, E, qDomain) {
  let kh = 0, longKey = 0, idfScore = 0, distinct = 0;
  for (const k of (E.keys || [])) {
    const nk = ROUTE.NORM(k);
    if (nq.indexOf(nk) >= 0) {
      kh++;
      if (nk.length >= 3) longKey++;
      idfScore += (IDF_PENALTY[k] || 1.0) * 2;
      if (nk.length >= 2 && !GENERIC_KEYS.has(k) && !isChemKey(k, nk)) distinct++;
    }
  }
  let entHit = 0, entStrong = 0;
  for (const en of (E.ents || [])) {
    if (nq.indexOf(ROUTE.NORM(en)) >= 0) { entHit++; if (!GENERIC_KEYS.has(en) && !isChemKey(en)) entStrong++; }
  }
  let titleTopical = 0; const nTitle = ROUTE.NORM(E.title || '');
  for (const k of (E.keys || [])) { const nk = ROUTE.NORM(k); if (nk.length >= 2 && !GENERIC_KEYS.has(nk) && nTitle.indexOf(nk) >= 0) { titleTopical = (nk.length >= 3 && !isChemKey(k)) ? 5 : Math.max(titleTopical, 3); } }
  const fq = ROUTE.NORM(ROUTE.FIXTYPO(E.q || ''));
  const exactQ = fq && fq === nq;
  const longBonus = (longKey > 0) ? Math.min(2, ((E.answer || '').length + (E.detail || '').length) / 800) : 0;
  const opIntent = OP_RE.test(nq) ? 1 : 0;
  const stepTpl = STEP_TEMPLATE_RE.test(nq) ? 1 : 0;
  const firehose = (E.keys || []).length > 45 ? 1 : 0;
  const notOther = (!/(草酸合铜|二草酸合铜|草酸铬|草酸铝|草酸钴|草酸合铝|草酸合铬|草酸合钴|铜\(?ii\)?|铜\(?Ⅱ\)?|铬\(?iii\)?|铝\(?iii\)?|钴\(?iii\)?|二草酸|草酸合)/.test(nq) && !/(其它|其他|对比|比较|同类|类比|举例|受控合成|两种水合|分别(得到|探究|控制|合成|结晶|制备))/.test(nq)) ? 1 : 0;
  const subfieldMatch = (E.subfield === qDomain) ? 1 : 0;
  // 15 维
  return [
    subfieldMatch,             // 0
    Math.min(kh, 5) / 5,       // 1 keyHit
    Math.min(distinct, 4) / 4, // 2 distinctHits
    Math.min(longKey, 3) / 3,  // 3 longKey
    Math.min(idfScore, 6) / 6, // 4 idfKeyScore
    Math.min(entHit, 3) / 3,   // 5 entHit
    Math.min(entStrong, 2) / 2,// 6 entStrong
    titleTopical / 5,          // 7 titleTopical
    exactQ ? 1 : 0,            // 8 exactQ
    opIntent,                  // 9 opIntent
    stepTpl,                   // 10 stepTemplate
    longBonus / 2,             // 11 lenBonus
    firehose,                  // 12 firehose
    notOther,                  // 13 notOtherQ
    (E.keys || []).length > 3 ? 1 : 0 // 14 richKeys
  ];
}

// ==== 构造训练集 ====
// gold 正样本：(串, goldEntry)
const goldPos = [];
for (const q of bank) { const e = q.faq_verify && titleIndex.get(q.faq_verify); if (e) goldPos.push({ q: q.faq_verify, E: e, gold: true }); }
for (const a of adv) { const e = titleIndex.get(a.intended_title); if (e) goldPos.push({ q: a.rephrased, E: e, gold: true }); }
// 弱监督正样本：每条目显著 key 当作"用户问法"
const weakPos = [];
for (const E of faq) { for (const k of (E.keys || [])) { const nk = ROUTE.NORM(k); if (nk.length >= 3 && !GENERIC_KEYS.has(k) && !CHEM_NOUN.has(k) && weakPos.length < 60000) weakPos.push({ q: k, E, gold: false }); } }
// 负样本：每条正样本取"同子域 features 最接近"的硬负样本 + 1 个异域随机负样本
const subIndex = new Map();
faq.forEach((E) => { const s = E.subfield || ''; if (!subIndex.has(s)) subIndex.set(s, []); subIndex.get(s).push(E); });
function negative(p) {
  const pool = subIndex.get(p.E.subfield) || [];
  const cand = pool.filter((e) => e !== p.E);
  // 用 idfScore 近似"竞争度"（越接近越难）
  const nq = ROUTE.NORM(ROUTE.FIXTYPO(p.q));
  const scored = cand.map((e) => ({ e, s: feat(nq, e, p.E.subfield)[4] })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.e);
  const other = faq[(Math.abs(hash(p.q + p.E.title)) % faq.length)];
  return scored.concat([other !== p.E ? other : faq[(Math.abs(hash(p.q + p.E.title)) + 7) % faq.length]]);
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// 组装训练样本（带 gold 标记，验证集只用 gold）
const trainPool = [];
for (const p of goldPos) {
  trainPool.push({ x: feat(ROUTE.NORM(ROUTE.FIXTYPO(p.q)), p.E, p.E.subfield), y: 1, gold: true });
  for (const neg of negative(p)) trainPool.push({ x: feat(ROUTE.NORM(ROUTE.FIXTYPO(p.q)), neg, p.E.subfield), y: 0, gold: true });
}
for (const p of weakPos) {
  trainPool.push({ x: feat(ROUTE.NORM(ROUTE.FIXTYPO(p.q)), p.E, p.E.subfield), y: 1, gold: false });
}

// ==== train/val 切分（gold 80/20，弱监督只在 train）====
const gold = trainPool.filter((s) => s.gold);
const goldTrain = gold.filter((_, i) => i % 5 !== 0); // 80%
const goldVal = gold.filter((_, i) => i % 5 === 0);   // 20%
const weakTrain = trainPool.filter((s) => !s.gold).slice(0, 40000);
const trainX = goldTrain.concat(weakTrain).map((s) => s.x);
const trainY = goldTrain.concat(weakTrain).map((s) => s.y);
const valX = goldVal.map((s) => s.x);
const valY = goldVal.map((s) => s.y);

// ==== logistic 回归（L2 + GD，early-stopping）====
const D = trainX[0].length;
// 类别平衡：负样本加权（约 正:负=1:3 → 负权重 .33）
function run(lam, lr, epochs) {
  let w = new Array(D).fill(0), b = 0;
  const n = trainX.length;
  function lossGrad() {
    const g = new Array(D).fill(0); let gb = 0, loss = 0;
    for (let i = 0; i < n; i++) {
      const z = dot(w, trainX[i]) + b;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - trainY[i];
      const wgt = trainY[i] === 0 ? 0.33 : 1;
      loss += wgt * -(trainY[i] * Math.log(p + 1e-9) + (1 - trainY[i]) * Math.log(1 - p + 1e-9));
      for (let d = 0; d < D; d++) g[d] += wgt * err * trainX[i][d];
      gb += wgt * err;
    }
    for (let d = 0; d < D; d++) g[d] = g[d] / n + lam * w[d];
    return { g, gb: gb / n, loss: loss / n };
  }
  let best = { w: w.slice(), b: b, vloss: Infinity, patience: 0 };
  for (let e = 0; e < epochs; e++) {
    const { g, gb } = lossGrad();
    for (let d = 0; d < D; d++) w[d] -= lr * g[d];
    b -= lr * gb;
    // val loss
    let vl = 0; for (let i = 0; i < valX.length; i++) { const p = 1 / (1 + Math.exp(-(dot(w, valX[i]) + b))); vl += -(valY[i] * Math.log(p + 1e-9) + (1 - valY[i]) * Math.log(1 - p + 1e-9)); }
    vl /= valX.length;
    if (vl < best.vloss) { best = { w: w.slice(), b, vloss: vl, patience: 0 }; } else if (++best.patience >= 8) break;
  }
  return best;
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// 超参网格（防过拟合，v87 教训）
let best = null;
for (const lam of [0.3, 1.0, 3.0]) for (const lr of [0.1, 0.3]) {
  const m = run(lam, lr, 120);
  if (!best || m.vloss < best.vloss) best = m;
}

// ==== 验证 P/R/F1（gold val）====
function metrics(w, b, X, Y, thr) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < X.length; i++) {
    const p = 1 / (1 + Math.exp(-(dot(w, X[i]) + b))) >= thr ? 1 : 0;
    if (p === 1 && Y[i] === 1) tp++; else if (p === 1) fp++; else if (p === 0 && Y[i] === 1) fn++; else tn++;
  }
  const P = tp / (tp + fp || 1), R = tp / (tp + fn || 1);
  return { P, R, F1: 2 * P * R / (P + R || 1) };
}
const tr = metrics(best.w, best.b, trainX, trainY, 0.5);
const va = metrics(best.w, best.b, valX, valY, 0.5);
console.log('特征维度=' + D + '  gold正=' + goldPos.length + ' 弱监督正=' + weakPos.length + ' 训练样本=' + trainX.length);
console.log('train  P/R/F1 = ' + tr.P.toFixed(3) + '/' + tr.R.toFixed(3) + '/' + tr.F1.toFixed(3));
console.log('val    P/R/F1 = ' + va.P.toFixed(3) + '/' + va.R.toFixed(3) + '/' + va.F1.toFixed(3));
console.log('reg_loss(best)=' + best.vloss.toFixed(4));

// ==== 烘焙权重之 JS ====
const wJson = best.w.map((v) => +v.toFixed(4));
const routeW = '/* 由 训练管道/train_router.js 监督学习生成 —— 请勿手改，重新训练再生成 */\n/* ' + new Date().toISOString().slice(0, 10) + ' valF1=' + va.F1.toFixed(3) + ' */\n(function(){\n  var w=' + JSON.stringify(wJson) + ', b=' + (+best.b.toFixed(4)) + ';\n  var api={w:w,b:b};\n  if(typeof module!==\'undefined\'&&module.exports)module.exports=api;\n  if(typeof window!==\'undefined\'){window.RouteWeights=api;}\n})();\n';
fs.writeFileSync(path.join(ROOT, 'scripts', 'route-weights.js'), routeW);
console.log('已写 scripts/route-weights.js');
