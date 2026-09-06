'use strict';
/**
 * eval-router.js — 决策树路由器的"精准优先"评测门禁（Node，磁盘运行）。
 *
 * 以 route-local.js 内嵌的 matchFAQ 逐字公式为基线（与 assistant.html matchFAQ 相同），
 * 对比「基线 vs 路由(routeLocalAnswer || 基线)」在两组上的命中：
 *   Set A：questions_bank.json 中 faq_verify 精确命中某 FAQ title 的 125 条（query=faq_verify, intended=该title）
 *   Set B：test/queries_adversarial.json 的 20 个对抗改写（query=rephrased, intended=intended_title）
 * 输出：各 set 的 base/route 命中率、route fire_rate、覆盖列表（route 与 base 返回不同 title 者）。
 * PASS 判据人工复核覆盖列表：覆盖率内不得出现"基线对而路由错"（regressions）。
 */
const path = require('path');
const { readFAQRuntime } = require('./lib-assistant-faq.js');
const ROUTE = require('./route-local.js');
const faq = readFAQRuntime();

function readJson(fp) { let r = require('fs').readFileSync(fp, 'utf8'); if (r.charCodeAt(0) === 0xFEFF) r = r.slice(1); return JSON.parse(r); }

// Set A：faq_verify 精确命中某 FAQ title
const titleIndex = new Map();
faq.forEach((f, i) => { if (f.title) titleIndex.set(f.title, i); });
const bank = readJson(path.join(__dirname, '..', 'data', 'questions_bank.json')).questions;
const setA = [];
for (const q of bank) {
  if (q.faq_verify && titleIndex.has(q.faq_verify)) setA.push({ qid: q.id, query: q.faq_verify, intended: q.faq_verify });
}
// Set B：对抗改写
const setB = readJson(path.join(__dirname, '..', 'test', 'queries_adversarial.json'));

function run(items) {
  let baseHit = 0, routeHit = 0, fired = 0, firedHit = 0, regressions = 0, overrides = [];
  for (const it of items) {
    const q = it.query || it.rephrased;
    const b = ROUTE.matchFAQBaseline(q, faq);
    const bTitle = b ? b.title : '(无命中)';
    const r = ROUTE.routeLocalAnswer(q, faq);
    const routeTitle = (r ? r.title : (b ? b.title : '(无命中)'));
    const firedThis = !!r;
    const baseOk = bTitle === it.intended;
    const routeOk = routeTitle === it.intended;
    if (baseOk) baseHit++;
    if (routeOk) routeHit++;
    if (firedThis) { fired++; if (routeOk) firedHit++; }
    if (baseOk && !routeOk) regressions++;
    if (firedThis && baseOk !== routeOk) overrides.push({ qid: it.qid, query: q.slice(0, 24), intended: it.intended, base: bTitle === it.intended ? (b ? b.title : '(无)') : '✗', baseTitle: bTitle.slice(0, 22), routeTitle: routeTitle.slice(0, 22) });
  }
  return { n: items.length, baseHit, routeHit, fired, firedHit, regressions, overrides };
}

const A = run(setA);
const B = run(setB);
function pct(n, d) { return d ? Math.round(100 * n / d) : 0; }

console.log('========== 决策树路由器评测 ==========');
console.log('Set A (faq_verify 125)  : base 命中 ' + A.baseHit + '/' + A.n + ' (' + pct(A.baseHit, A.n) + '%)  |  route ' + A.routeHit + '/' + A.n + ' (' + pct(A.routeHit, A.n) + '%)');
console.log('Set B (对抗改写 20)     : base 命中 ' + B.baseHit + '/' + B.n + ' (' + pct(B.baseHit, B.n) + '%)  |  route ' + B.routeHit + '/' + B.n + ' (' + pct(B.routeHit, B.n) + '%)');
console.log('router fire_rate       : A ' + pct(A.fired, A.n) + '%  B ' + pct(B.fired, B.n) + '%   (A 命中/发射 ' + A.firedHit + '/' + A.fired + '  B ' + B.firedHit + '/' + B.fired + ')');
console.log('regressions (基线对而路由错): A=' + A.regressions + '  B=' + B.regressions);
console.log('');
console.log('---- 覆盖/改动明细（route 与 base 不同者，重点人工复核是否变差）----');
const allOv = A.overrides.concat(B.overrides);
if (!allOv.length) console.log('  （无覆盖，零改动）');
else allOv.forEach(o => console.log('  ' + o.qid + ' | ' + o.query + ' | 期望「' + o.intended + '」| base=' + (o.base === '✗' ? '✗(错)' : '✓') + ' | base→「' + o.baseTitle + '」 route→「' + o.routeTitle + '」'));
