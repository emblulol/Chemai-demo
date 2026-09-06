'use strict';
/**
 * route-local.js — assistant 本地回答的"子域优先决策树"路由器（gate 级，安全）。
 *
 * 设计（详见 README v88 / 本会话 plan）：
 *   · 绝不改动 assistant.html 内嵌 matchFAQ 的打分公式；本模块只在其"之前"做 gate。
 *   · 步骤：归一化 → 领域分类(17 canonical 子域, 需决断) → 域内匹配(逐字复刻 matchFAQ 打分, 迭代集收窄到该子域)
 *            → 三重置信门 → override-lock：仅当"matchFAQ 命中的条目 与 问句分类子域 不同(跨域误配)"时才覆盖；
 *            同域则信任 matchFAQ；matchFAQ 无命中则视为纯增益。
 *   · 任何不确定 → 返回 null → 调用方回退到原 matchFAQ。
 *
 * UMD：Node `require`；浏览器 `<script src="scripts/route-local.js">` → window.RouteLocal / window.routeLocalAnswer。
 */

(function () {
  'use strict';

  // ===== 归一化（与 assistant.html norm / fixTypos 逐字对齐，来源 L660 / L1161-1175）=====
  var SUBMAP = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','⁻':'-','⁺':'+','⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9' };
  function NORM(s) {
    return String(s || '').toLowerCase().replace(/双氧水/g, '过氧化氢').replace(/[₀₁₂₃₄₅₆₇₈₉⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]/g, function (c) { return SUBMAP[c] || c; }).replace(/摄氏度|℃|°c/g, '度').replace(/\s+/g, '');
  }
  var _typoFix = {
    '过氧化轻':'过氧化氢','草酸铁甲':'草酸铁钾','草酸铁钾钾':'草酸铁钾',
    '三草酸合铁甲':'三草酸合铁钾','莫耳盐':'莫尔盐','摩尔塩':'莫尔盐',
    '双氧水水':'双氧水','抽滤瓶':'抽滤','草酸根根':'草酸根',
    '氢氧化铁铁':'氢氧化铁','络合物':'配合物','铁氰化钾':'铁氰化钾'
  };
  function FIXTYPO(q) {
    var fixed = q, keys = Object.keys(_typoFix);
    for (var i = 0; i < keys.length; i++) { var wrong = keys[i]; if (fixed.indexOf(wrong) >= 0) fixed = fixed.split(wrong).join(_typoFix[wrong]); }
    return fixed;
  }

  // ===== matchFAQ 打分常量（逐字，来自 assistant.html L1181-1197）=====
  var IDF_PENALTY = { '实验':0.4,'制备':0.5,'化学':0.5,'操作':0.6,'步骤':0.6,'原理':0.5,'方法':0.6,'分析':0.6,'测定':0.6,'研究':0.7,'反应':0.5,'产物':0.6,'合成':0.5,'配合物':0.6 };
  var GENERIC_KEYS = { '实验':1,'制备':1,'化学':1,'操作':1,'步骤':1,'原理':1,'方法':1,'分析':1,'测定':1,'研究':1,'反应':1,'产物':1,'合成':1,'配合物':1,'氧化':1,'温度':1,'产率':1,'沉淀':1,'结晶':1,'过滤':1,'洗涤':1,'烘干':1,'干燥':1,'避光':1,'加热':1,'冷却':1,'溶解':1,'静置':1,'时间':1,'颜色':1,'现象':1,'安全':1,'影响':1,'原因':1,'过程':1,'条件':1,'用量':1,'浓度':1,'作用':1,'顺序':1,'终点':1,'检验':1,'验证':1,'水浴':1,'搅拌':1,'生成':1,'分解':1,'方程式':1,'反应方程式':1,'化学方程式':1,'为什么':1,'为何':1,'如何':1,'怎么':1,'怎样':1,'怎么样':1,'什么':1,'是否':1,'多少':1,'哪些':1,'哪个':1,'哪儿':1,'哪里':1,'几':1,'吗':1,'呢':1,'怎么算':1,'怎么求':1,'怎么计算':1,'怎么测定':1,'怎么数':1,'怎么办':1,'怎么处理':1,'怎么判断':1,'怎么区分':1,'怎么表示':1,'怎么验':1,'咋算':1,'到底咋算':1,'怎么推导':1,'怎么理解':1,'怎么解释':1,'怎么选':1,'怎么配':1,'怎么加':1,'为什么会':1,'是什么':1,'是怎么':1,'是不是':1,'是几':1,'是啥':1 };
  var CHEM_NOUN = { '草酸':1,'莫尔盐':1,'摩尔盐':1,'乙醇':1,'过氧化氢':1,'铁氰化钾':1,'硫酸亚铁':1,'草酸钾':1,'草酸根':1,'三草酸':1,'氢氧化铁':1,'硫酸':1,'氨水':1,'双氧水':1,'配离子':1,'酸根':1,'草酸氢钾':1,'草酸亚铁':1 };
  var FH_THRESH = 45;
  var OP_RE = /(终点|判断|速度|距离|多久|何时|顺序|先后|洗涤|烘干|冷却|加热|过滤|抽滤|水浴|暴沸|防止|避免|补救|滴加|用量|比例|操作|步骤|干燥|称量|量取|检验|如何判断|怎么判断)/;
  var STEP_TEMPLATE_RE = /(第[一二三四五六七八九十百\d]+步|深度解析|反应机理|热力学与动力学|氧化电位)/;
  var IRON_RE = /(三草酸合铁|草酸亚铁|莫尔盐|摩尔盐|硫酸亚铁|氢氧化铁|亚铁|铁草酸|铁\(?iii\)?|铁\(?Ⅲ\)?|高铁|k3\[fe|k3\[fec|fe3\+|草酸铁钾|三草酸合铁钾)/;
  var OTHER_OX_RE = /(草酸合铜|二草酸合铜|草酸铬|草酸铝|草酸钴|草酸合铝|草酸合铬|草酸合钴|铜\(?ii\)?|铜\(?Ⅱ\)?|铬\(?iii\)?|铝\(?iii\)?|钴\(?iii\)?|二草酸|草酸合)/;
  var cmpQ = /(其它|其他|对比|比较|同类|类比|举例|受控合成|两种水合|分别(得到|探究|控制|合成|结晶|制备))/;
  function isChemicalKey(k, nk) { return /[a-z0-9]/.test(nk || NORM(k)) || !!CHEM_NOUN[k]; }
  function isStepTemplate(f) { return STEP_TEMPLATE_RE.test(NORM((f.title || '') + '|' + String(f.answer || ''))); }

  // ===== 单条目打分（逐字复刻 matchFAQ L1199-1236 的 score 逻辑，返回 score 与证据标志）=====
  function scoreEntry(nq, f) {
    var i, j, k, nk, kh = 0, longKey = 0, keyScore = 0, hits = [], distinctHits = 0;
    for (j = 0; j < f.keys.length; j++) {
      k = f.keys[j]; nk = NORM(k);
      if (nq.indexOf(nk) >= 0) {
        kh++; hits.push(k);
        if (nk.length >= 3) longKey++;
        var idf = IDF_PENALTY[k] || 1.0;
        keyScore += 2 * idf;
        if (nk.length >= 2 && !GENERIC_KEYS[k] && !isChemicalKey(k, nk)) distinctHits++;
      }
    }
    var eh = 0, entScore = 0;
    for (j = 0; j < (f.ents || []).length; j++) {
      var en = f.ents[j];
      if (nq.indexOf(NORM(en)) >= 0) { eh++; if (!GENERIC_KEYS[en] && !isChemicalKey(en)) entScore += 2; else entScore += 1; }
    }
    var fq = NORM(FIXTYPO(f.q || ''));  // 存储q也过 fixTypos，与 nq 对齐（同 matchFAQ L1218）
    var exactQ = fq && fq === nq;
    var trig = (kh >= 2) || (kh >= 1 && eh >= 1) || (eh >= 2) || (distinctHits >= 1) || exactQ;
    if (!trig) return null;
    var lenBonus = (longKey > 0) ? Math.min(2, ((f.answer || '').length + (f.detail || '').length) / 800) : 0;
    var titleTopical = 0, nTitle = NORM(f.title || '');
    for (i = 0; i < hits.length; i++) {
      var _nk = NORM(hits[i]);
      if (hits[i].length >= 2 && !GENERIC_KEYS[_nk] && nTitle.indexOf(_nk) >= 0) { if (_nk.length >= 3 && !isChemicalKey(hits[i])) titleTopical = 5; else if (titleTopical < 3) titleTopical = 3; }
    }
    var score = keyScore + entScore + longKey * 0.5 + lenBonus + titleTopical + distinctHits * 2;
    if (f.keys.length > FH_THRESH && titleTopical < 5) score *= Math.pow(FH_THRESH / f.keys.length, 0.5);
    if (exactQ || (fq.length >= 15 && (nq.indexOf(fq) >= 0 || fq.indexOf(nq) >= 0))) score += 200;
    if (OP_RE.test(nq) && isStepTemplate(f)) score *= 0.12;
    var notOtherQ = !OTHER_OX_RE.test(nq) && !cmpQ.test(nq);
    if (notOtherQ) { var tfn = NORM((f.title || '') + '|' + String(f.answer || '')); if (OTHER_OX_RE.test(tfn) && !IRON_RE.test(tfn)) score *= 0.03; }
    return { score: score, distinctHits: distinctHits, entScore: entScore, titleTopical: titleTopical, exactQ: exactQ };
  }

  // ===== 全库 matchFAQ 基线（复制 matchFAQ 语义，返回 {entry, score, subfield} 或 null）=====
  function _matchFAQ(nq, faq) {
    var best = null, bestScore = 0;
    for (var i = 0; i < faq.length; i++) {
      var r = scoreEntry(nq, faq[i]);
      if (r && r.score > bestScore) { bestScore = r.score; best = faq[i]; }
    }
    return best ? { entry: best, score: bestScore, subfield: best.subfield || '' } : null;
  }

  // ===== 子域优先决策树：领域分类（17 canonical）=====
  // 高精度手工锚词表：w=2 表示"决定性/专指"锚；w=1 表示一般领域词。只取少量、能区分 17 子域的词，避免跨域实体渗透。
  var DOMAIN_CLASSIFIER = [
    { sub: '合成制备',   w: 1, terms: ['制备','合成','四步','试剂用量','投料','原料','称取','沉淀得到','制备流程','先后顺序'] },
    { sub: '反应原理',   w: 2, terms: ['离子方程式','氧化还原','电极电位','电动势','电子转移','平衡常数','自发','e度','电对','氧化反应'] },
    { sub: '实验操作',   w: 2, terms: ['抽滤','减压过滤','布氏漏斗','微沸','水浴','烘干','称量','滴加','洗涤','冷却','终点','量取','暴沸','煮沸','干燥','操作步骤','如何判断终点'] },
    { sub: '分析测定',   w: 2, terms: ['产率','滴定','含量','纯度','组成','误差','标准偏差','百分含量','数据分析','rsd','测定'] },
    { sub: '光化学应用', w: 2, terms: ['光化学','光解','光致还原','见光','避光','光敏','lmct','蓝晒','感光','曝光'] },
    { sub: '结构表征',   w: 2, terms: ['红外','光谱','紫外','表征','晶系','空间群','晶胞','衍射','结构参数','摩尔质量','密度'] },
    { sub: '磁性研究',   w: 2, terms: ['磁化率','磁性','磁矩','磁天平','未成对电子','高自旋','低自旋'] },
    { sub: '热分析',     w: 2, terms: ['热分解','热重','热分析','差热','失重','tga','dsc','分解温度','热稳定'] },
    { sub: '安全与废物处理', w: 2, terms: ['废液','安全','防护','腐蚀','溅','毒','危害','环保','处理','急救','废液处理'] },
    { sub: '配位化学理论', w: 2, terms: ['配位','配合物','内外界','内界','外界','配体','中心离子','配位数','螯合','晶体场','分裂能','稳定常数','维尔纳','八面体'] },
    { sub: '实验教学',   w: 2, terms: ['教学','报告','设计','反思','改进','技能','目标','评价','实验报告','教学反思'] },
    { sub: '化学史',     w: 2, terms: ['维尔纳','塔萨厄尔','历史','发现','诺贝尔','1798','1893','第一个','学者'] },
    { sub: '高等理论',   w: 2, terms: ['理论','计算','误差','标准偏差','jahn','tanabe','精密度','公式推导'] },
    { sub: '综合研究',   w: 1, terms: ['因素','影响','比较','对比','性质','原因','为什么','区别','异同','综合'] },
    { sub: '蓝晒工艺',   w: 2, terms: ['蓝晒','晒图','晒蓝','cyanotype','显影','定影','晒制'] },
    { sub: '摩尔盐相关', w: 2, terms: ['莫尔盐','摩尔盐','硫酸亚铁铵','亚铁铵','摩尔盐含量','绿矾'] },
    { sub: '草酸配合物', w: 2, terms: ['草酸合铜','二草酸合铜','草酸铬','草酸铝','草酸钴','草酸合铝','草酸合铬','草酸合钴','二草酸','配体替换'] }
  ];

  var MIN_DOMAIN = 2;        // 领域分下限
  var MARGIN_RATIO = 1.8;    // top 须 >= ratio*second
  var MARGIN_GAP = 1.0;      // top-second 须 >= gap
  var ROUTER_MIN_SCORE = 10; // 域内 top 分下限（保守/安全档：0 回退；更宽会引入回退——见评测）
  var ROUTER_MARGIN_RATIO = 2.0;
  var ROUTER_MARGIN_GAP = 6.0;

  function classifyDomain(nq) {
    var scores = {}, i, j, def;
    for (i = 0; i < DOMAIN_CLASSIFIER.length; i++) {
      def = DOMAIN_CLASSIFIER[i];
      var s = 0;
      var terms = def.terms;
      for (j = 0; j < terms.length; j++) { if (nq.indexOf(NORM(terms[j])) >= 0) s += def.w; }
      if (s > 0) scores[def.sub] = (scores[def.sub] || 0) + s;
    }
    var keys = Object.keys(scores);
    if (!keys.length) return null;
    keys.sort(function (a, b) { return scores[b] - scores[a]; });
    var top = scores[keys[0]], second = keys.length > 1 ? scores[keys[1]] : 0;
    if (top < MIN_DOMAIN) return null;
    if (top < MARGIN_RATIO * second || top - second < MARGIN_GAP) return null;
    return keys[0];
  }

  // ===== 子域索引（懒构建，按 faq.length 缓存）=====
  var _idxCache = { len: -1, map: null };
  function buildSubfieldIndex(faq) {
    if (_idxCache.len === faq.length && _idxCache.map) return _idxCache.map;
    var map = new Map();
    for (var i = 0; i < faq.length; i++) {
      var sub = faq[i].subfield || '';
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub).push(faq[i]);
    }
    _idxCache = { len: faq.length, map: map };
    return map;
  }

  // ===== 域内匹配：仅在该子域池内跑 matchFAQ 打分语义，返回 {entry,score,runner} 或 null =====
  function _matchPool(nq, pool) {
    var top = null, topScore = 0, runner = null, runnerScore = 0;
    for (var i = 0; i < pool.length; i++) {
      var r = scoreEntry(nq, pool[i]);
      if (r && r.score > topScore) { runner = top; runnerScore = topScore; topScore = r.score; top = pool[i]; }
      else if (r && r.score > runnerScore) { runnerScore = r.score; runner = pool[i]; }
    }
    return { entry: top, score: topScore, runnerScore: runnerScore, runner: runner };
  }

  // ===== 主入口：routeLocalAnswer(q, faqArray) → 条目对象 | null =====
  function routeLocalAnswer(q, faq) {
    try {
      if (!faq || !faq.length) return null;
      var nq = NORM(FIXTYPO(q));
      if (nq.length < 2) return null;
      var domain = classifyDomain(nq);
      if (!domain) return null;
      var map = buildSubfieldIndex(faq);
      var pool = map.get(domain);
      if (!pool || !pool.length) return null;
      var rt = _matchPool(nq, pool);
      if (!rt || !rt.entry) return null;
      // 门 b：域内 top 显著领先
      if (rt.score < ROUTER_MIN_SCORE) return null;
      if (!(rt.score >= ROUTER_MARGIN_RATIO * rt.runnerScore || rt.score - rt.runnerScore >= ROUTER_MARGIN_GAP)) return null;
      // 门 c：强证据（62.8% 条目 ents 空 → 必须靠 keys/title 而非单靠共享化学实体）
      var sr = scoreEntry(nq, rt.entry);
      if (!(sr && (sr.distinctHits >= 1 || sr.entScore >= 2 || sr.titleTopical >= 3 || sr.exactQ))) return null;
      // 采用：路由器在高置信下返回"域内最优"（三重门已保证）。安全由 Set A(125 faq_verify) 的零回退 + 人工复核把关；
      // 同域还是跨域均由域内 scoring 决定，不再"同域让给 matchFAQ"（那会放过同域误配）。不一致才真正改变选择。
      var mf = _matchFAQ(nq, faq);
      if (mf && mf.entry === rt.entry) return rt.entry;   // 与基线一致
      return rt.entry;
    } catch (e) {
      return null;
    }
  }

  var api = {
    routeLocalAnswer: routeLocalAnswer,
    classifyDomain: classifyDomain,
    buildSubfieldIndex: buildSubfieldIndex,
    matchFAQBaseline: function (q, faq) { var nq = NORM(FIXTYPO(q)); var m = _matchFAQ(nq, faq); return m ? m.entry : null; },
    _matchPool: _matchPool,
    _matchFAQ: _matchFAQ,
    scoreEntry: scoreEntry,
    NORM: NORM,
    FIXTYPO: FIXTYPO,
    DOMAIN_CLASSIFIER: DOMAIN_CLASSIFIER
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.RouteLocal = api; window.routeLocalAnswer = api.routeLocalAnswer; }
})();
