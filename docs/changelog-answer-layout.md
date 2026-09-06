# Changelog · AI 助手回答布局优化

> 文件：`assistant.html`、`assets/assistant-model.js`
> 日期：2026-09-05
> 最终形态：**回答正文干脆利落置顶，「还想接着聊」与「更多信息」并列，其余内容按四大分支分类收进「更多信息」下拉菜单。**

---

## 一、最终范式

AI 助手「回答结果」自上而下：回答正文 → 还想接着聊 / 更多信息（并列）→ 操作按钮。

```text
[回答正文 —— 直接可见，第一要素，无标题、无引导语、无 emoji 前缀]

还想接着聊：[chip][chip][chip][chip]        ← 并列可见（追问 chips）

更多信息 ▸                                 ← 并列、默认折叠，内含四大分支分类：
  依据与来源
    来源·置信度徽章（高置信度 / 内置FAQ / 专业 / N 篇文献）
    置信度条（语料库 / 类比 / 综合）
    文献题录（简洁列表）+ 文献卡片 ▸
  深度与延伸
    模式说明（入门版 / 深度版 / 文献版 / 图示版）
    原理与细节 ▸
    类比推理桥接 ▸
    类比来源文献 ▸
    知识延伸
  资源与安全
    网络补充（链接）
    相关图片 ▸
    MSDS ▸ / 相关视频 ▸
    教学工具（教师身份）
  检查与思考
    自我检查 ▸（仅检出问题时）
    报告解析 ▸ / 文件上下文 ▸（仅上传文件时）
    思考链 ▸（执行计划 / 检索来源 / 置信度 / 自查）

[📒 记入错题本] [👍] [👎]（集群模式追加：重新生成 / 加强网页检索 / 用LLM重答 / 运行技能）
```

### 规则

1. **回答正文第一**：`core` 是唯一默认可见的内容，直接呈现问题答案（命中计算时，当场算出的公式+结果优先）。
2. **追问与详情并列**：「还想接着聊」chips 与「更多信息」下拉菜单同层级、并列，都在正文之后。
3. **详情分四大类**：下拉菜单内按「依据与来源 / 深度与延伸 / 资源与安全 / 检查与思考」四个分支分类，纯文字小标题，空分支自动隐藏。
4. **纯文字多结构**：区段标题为纯文字（无 emoji 前缀），层级靠加粗标题 + 折叠条 + 段落/列表实现。
5. **操作按钮收尾**：错题本 / 反馈按钮始终可见、位于末尾。

### 两个保留例外（非「依据/思考」类内容）

- **`🔁 已结合上文理解`**（仅追问时置顶一行）—— 属提问澄清。
- **`🛡️ 安全提醒`**（非化学身份置顶）—— 安全优先，标注「先看这个」。

---

## 二、演进历程（本次迭代 6 轮）

| 轮 | 目标 | 关键改动 |
|---|---|---|
| 1 | 回答内容第一 | `buildAnswerHTML`/`buildAnalogyBridgedAnswer` 拆分 `core`/`tail`；置信度、报告解析由「前置」改「后置」 |
| 2 | 减轻刻意化 | 去除所有区段标题/徽章/引导句的 emoji 前缀，改为纯文字 |
| 3 | 答案直接呈现 | 删除「核心解答」标题与身份引导句（`roleLeadHTML`），正文即答案 |
| 4 | 简洁呈现 | 拆掉单一大折叠，来源/文献/网络/延伸/置信度改为可见（`secHTML`），仅深层内容折叠 |
| 5 | 单一下拉收尾 | 归并为一个 `更多信息` 下拉菜单（`moreFoldHTML`），思考链也并入 |
| 6 | 并列 + 分类 | 「还想接着聊」与「更多信息」并列；`更多信息` 内按四大分支分类（`moreGroupHTML`） |

---

## 三、关键实现（最终状态）

### ① 顶层装配：返回 `{core, outro, basis, deep, resource}`

**位置**：`assistant.html:1374`（`buildHybridAnswerHTML`），返回 `:1391`

```js
function buildHybridAnswerHTML(q, ctx){
  ...
  var parts; // buildAnswerHTML / buildAnalogyBridgedAnswer → {core, basis, deep, resource}
  ...
  // 回答结构优化：回答正文置顶；「还想接着聊」并列；其余内容按分支分类收进正文末尾的下拉菜单。
  return {core: parts.core, outro: roleOutroHTML(chatRole()),
    basis: parts.basis, deep: modeLead + parts.deep, resource: parts.resource + teacherBarHTML()};
}
```

### ② 辅助函数：可见小节 / 下拉菜单 / 分支分类

**位置**：`assistant.html:1403`（`secHTML`）、`:1407`（`moreFoldHTML`）、`:1412`（`moreGroupHTML`）

```js
/* 可见简洁小节：带标题、不折叠，用于来源/文献/网络/延伸等简洁呈现。 */
function secHTML(title, body){
  return '<div class="ans-sec"><h4>'+title+'</h4>'+body+'</div>';
}
/* 单一下拉菜单：把答案正文之外的全部内容简化收进末尾折叠。 */
function moreFoldHTML(innerHTML){
  if(!innerHTML) return '';
  return '<details class="ref-fold more-fold"><summary>更多信息<span class="rf-arrow">▸</span></summary><div class="ref-fold-body">'+innerHTML+'</div></details>';
}
/* 下拉菜单内的分支分类小标题（纯文字，无 emoji）。 */
function moreGroupHTML(title, body){
  if(!body) return '';
  return '<div style="margin:6px 0 0"><div style="font-size:12px;font-weight:600;color:var(--t2,#94a3b8);margin:0 0 6px">'+title+'</div>'+body+'</div>';
}
```

### ③ 正文与依据的分离（返回 `{core, basis, deep, resource}`）

**位置**：`assistant.html:2235`（`buildAnswerHTML`）、`:1445`（`buildAnalogyBridgedAnswer`）

- `core`：`<div class="ans-sec">` + `roleCoreHTML(...)`（无引导句，直接返回「计算结果 / 正文」）。
- `basis`（依据与来源）：`answerHeaderHTML`（来源/置信度徽章）+ 文献题录（`secHTML`）+ 文献卡片折叠。
- `deep`（深度与延伸）：原理与细节（折叠）+ 类比推理桥接（折叠）+ 类比来源文献（折叠）+ 知识延伸（`secHTML`）。
- `resource`（资源与安全）：网络补充（`secHTML`）+ 相关图片（折叠）。

### ④ `handleQA` 按四大分支汇总并收进下拉

**位置**：`assistant.html:3282`（分支变量）、`:3389`（组装）

```js
var moreBasis='', moreDeep='', moreResource='', moreCheck='', outro='';
if(!usedLLM){
  var hybrid=buildHybridAnswerHTML(q, hybridCtx);
  html=hybrid.core; outro=hybrid.outro;
  moreBasis=hybrid.basis; moreDeep=hybrid.deep; moreResource=hybrid.resource;
  if(chems.length) moreResource+='...MSDS...';
  if(ops.length){ moreResource+='...相关视频...'; }
  if(llmNote) moreCheck+=llmNote;
  moreBasis+='...置信度条...';
}
...
if(warnHTML){ moreCheck+='...自我检查...'; }
if(UPLOADED_FILE && detectReportIntent(rawQ)){ moreCheck+='...报告解析...'; }
if(UPLOADED_FILE){ moreCheck+='...文件上下文...'; }
...
if(_rHTML){ moreCheck+=_rHTML; }   // 思考链并入「检查与思考」
...
/* 组装：依据与来源 / 深度与延伸 / 资源与安全 / 检查与思考 */
var more=moreGroupHTML('依据与来源', moreBasis)
       +moreGroupHTML('深度与延伸', moreDeep)
       +moreGroupHTML('资源与安全', moreResource)
       +moreGroupHTML('检查与思考', moreCheck);
if(ctxNote) html='<div class="ans-sec">'+ctxNote+'</div>'+html;
html=html+outro+moreFoldHTML(more);   // 正文 + 还想接着聊（并列）+ 更多信息下拉
html+='<div class="ans-sec">...记入错题本 / 👍 / 👎...</div>';
```

---

## 四、验证

- **语法**：11 个内联 `<script>` 块经 `vm.Script` 解析全部通过。
- **测试**：`npm test` → 67/67 通过。
- **打字机**：`回答正文`（`core`）作为富文本逐段输出；「更多信息」下拉菜单（`<details>`）作为即时块注入，无回归。
