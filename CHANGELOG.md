# ChemAI 更新日志

> 独立变更记录（README 版本历史之外的增量变更）。版本号承接 v71。

## v72.1（2026-08-25）— agent 调用管道修复

### 🔴 LLM 答案补质检/讲义核对（`assistant.html`）
- LLM 流式答案此前绕过质检：`selfCheck` 与 `manualAuthorityHTML`（`scanFacts`）只作用于本地混合答案的 `html`，LLM 时 `html` 为空。新增 `llmAnswerText` 记录 LLM 全文，`selfCheck`/`scanFacts` 改在 `usedLLM?llmAnswerText:html` 上运行，LLM 编造错误数值/方程式现在会被质检官与讲义核对拦截。

### 🟠 qaBusy 时序 + 按消息隔离上下文（`assistant.html`）
- 答案注入（打字机）包装为 `injectDone` Promise；网页研究员、技能官改为并发 `Promise.all([injectDone, webP, skillsP])`，`qaBusy` 待三者全部完成后再复位，消除提前放开输入导致的竞态。
- 每条气泡挂 `bub._qaCtx`/`bub._skillCtx`，操作按钮改传 `this`（`recordLastQA`/`recordFeedback`/`reAnswerWith`/`runSkillsOnLast`），经 `_qaCtxOf()` 从所属气泡取上下文——旧答案按钮不再误作用于新问题。
- `fbStatus` 重复 `id` 改 `class` 并按所属气泡定位，👍/👎 反馈提示落到正确气泡。

### 🟡 技能卡不再与打字机交错（`assistant.html`）
- `runSkills` 增加 `injectDone` 参数，技能派发包进 `(injectDone||Promise.resolve()).then(...)`，打字完成后再插入卡片。

### ⚪ 小问题（`assistant.html`）
- 删除 `runSkills` 重复「📄 报告官」注释；移除 `runWebResearch`→`AC.research` 冗余 `chems` 参数。

## v72（2026-08-25）— 助手代码清理 + 置信度口径 + 知识图谱深链

### 🧹 代码清理 / 死代码移除（`assistant.html`）
- 移除 v65 角色切换器残留死代码：`rolePersona()`、`setRole()`、`refreshRoleSwitch()`、`_lastRoleIntro`、`[data-role]` 委托分支，及 `.role-bar`/`.rs-chip`/`.role-intro` 死 CSS；保留深度门控（白话版/折叠）。
- 移除 `.faq-chip` 的 `document` + `qaChat` 双重绑定，统一由 `[data-q]` 委托处理。
- 合并重复领域正则：`AUTHORITY_DOMAIN_RE` 与 `handleQA` 内 `DOMAIN_RE` 收口为单一 `const DOMAIN_RE`。

### 🎯 置信度口径修正（`assistant.html`）
- 头部置信度徽章改用 `conf.level`（`buildHybridAnswerHTML` 传入 `conf`），与置信条同源，消除「头部低置信 / 条高置信」打架。
- FAQ 命中置信度由「命中即 0.9」改为按 `matchFAQ` 加权分映射（`matchScore` + `faqConfidence()`，0.5~0.95）。

### 🔀 工作模式 chips 修正（`assistant.html`）
- `quiz`/`mastery` 模式建议 chips 改为动作入口（「进入掌握度测评 / 打开精通之路」），不再把问题文本塞进输入框后跳转丢弃。

### 🛡️ 安全加固（`assistant.html`）
- 上传文件内容用 `<user-file>` 标签隔离，system prompt 增补第 5 条防提示词注入规则。
- PDF 解析改本地 `assets/vendor/pdf.min.js` / `pdf.worker.min.js`，去除 CDN 运行时依赖。

### 🧭 知识图谱深链（`assistant.html` + `knowledge.html` + `agent-cluster.js`）
- `extendHTML`「知识延伸」的 KG 链接改为 `knowledge.html?node=<…>` 深链；`knode` 空时回退 `subfield`，标签措辞区分「节点」/「相关」。
- `knowledge.html` 新增 `resolveDeepLink()`：`id` → 节点名 → 子领域 三级解析；子领域取「层级最浅 + 连接最多」的中心节点；双 `requestAnimationFrame` 首帧后定位。
- 新增 `SUBFIELD_ALIAS` 映射，6 个 FAQ 有而 KG 无的子领域兜底到 KG 节点（配位化学理论→`coord`、实验操作→`center-exp`、反应原理→`redox`、安全与废物处理→`safety-direction`、高等理论→`physical`、化学史→`tassaert-discovery`）。
- 集群「📊 图谱官」`kgSkill` 返回 `id` + 深链 URL，与正常模式口径一致。

### 📌 其他（`assistant.html`）
- 「⏹ 结束并生成报告」在测评未开始时不再误触发 `startAssess`。

### ✅ 验证
- 全文件内联脚本 + 独立 JS 语法检查通过；`SUBFIELD_ALIAS` 6 个 id 在 `kg.json` 全部命中；`npm test` 67/67 通过。
