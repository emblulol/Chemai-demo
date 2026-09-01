# ChemAI 更新日志

> 独立变更记录（README 版本历史之外的增量变更）。版本号承接 v71，当前 v75。

## v75（2026-09-01）— 数据自洽 + 主题跨页继承 + 图谱手机端优化

### 📊 数据一致性（`data/kg.json` / `data/corpus.json` / `academic_lexicon.json`）
- 知识图谱 9 个 `level:4` 节点归为 `level:3`「细分点」，层级分解加总=123，与徽章「知识点总数 123」自洽；清除 15 个节点遗留死字段 `cat`（旧分类体系残留、运行时代码零引用）。
- 语料库枚举归一：`difficulty` `中`→`中级`（15 条）、`doctype` `科普/讲义`→`科普`（1 条）。
- 学术词表 `stats.per_subfield` 去重重算，各子域加总对齐 `total`（13092 规范词 / 1440 实体），消除「分解加总 ≠ 总数」。

### 🌓 主题跨页继承（`index.html` + 全站 7 页）
- 根因：静态页用 `chemaiTheme`、React SPA（`#/videos`/`#/explore`/`#/report`）用 `chem-theme`，两键不互通，日间模式经 SPA 路由即断链。
- `index.html` 加主题桥接：加载时把 `chemaiTheme` 同步进 `chem-theme`（只改 `theme` 字段、保留其余 state）；运行时 `MutationObserver` 监听 `<html data-theme>` 变化写回 `chemaiTheme`。
- 全站 7 页统一 `<meta name="color-scheme">`，暗色原生控件观感一致。

### 📱 知识图谱手机端（`knowledge.html`）
- 标签字号随屏等比缩小（`fsScale = min(1, max(0.75, W/700))`），手机端二级/三级标签 12.5→9.4px、中心 17→12.75px。
- 布局缩放下限 `0.45`（原 `min(W,H)/1400` 无下限，手机端图谱被过度缩小）。
- `fitTarget` 留白改响应式（`<640px` 时 130/120px），图谱铺满约 83%（原约 61%）。
- `text-size-adjust:100%` 禁止 iOS 自动放大文字。

### ✅ 验证
- kg 层级/类目分解加总 123、边/relatedNodes/parent 引用零缺失；语料 445 条目子域/类型/语言求和自洽；词表 per_subfield 加总=total；跨版块子域映射核对完成。

## v74（2026-08-29）— 反 AI 味根因化 + 身份单一来源 + 性能/移动端/双端优化

### 🎨 UI 反 AI 味根因化（全 7 页 + `assets/hallmark.css`）
- 根除流光渐变标题 / 环境光斑 / 玻璃拟态 / 霓虹光晕：弃用 `hallmark.css` 的 `!important` 覆盖层，改各页源文件。删除 `--grad-crystal`/`--grad` token、`body::before`/`body::after` 光斑、`chemaiFlow/Pulse/Shine/Drift`/`gradFlow` keyframes。
- 标题/logo/统计数字/按钮统一单色：强调字用翡翠绿 `--em`/`--emerald`，统计数字用正文墨色 `--t1`；logo 去脉冲动画。
- `hallmark.css` 删除 5 条失效覆盖，仅保留衬线标题/移动端硬底线/浅色对比度。

### 👤 身份单一来源 + 管理员唯一入口（`index.html`/`main.html`/`assistant.html`）
- 身份识别只做一次、之后始终继承：`index.html` `<head>` 加已识别重定向（`location.replace("main.html")`）；「切换身份」清空 `chem-user` 后回落地页。
- 管理员作为落地页最底部整行卡片（`grid-column:1/-1`、琥珀 `#f59e0b`）、唯一入口（助手首次引导移除 admin 按钮）。
- 角色单一来源收敛到 `chem-user`：`assistant.html` `chatRole()` 改读它，删除 `chemai_user_v1.role` 字段与 `legacyRole()`；admin 纳入 `index`/`main` ROLES 映射 + 各页 `data-role-gate` 门控放行。

### ⚡ 加载效能
- Google Fonts 非阻塞（`preload`+`onload`+`<noscript>`）；KaTeX 加 `preconnect`；实验图/图片卡 `loading="lazy" decoding="async"`。
- 清理 174 个 `(2)` 陈旧副本（assets 13MB + 根目录 759KB）。

### 📱 移动端（`assets/mobile-content-guard.css` + 全站）
- `viewport-fit=cover` + `env(safe-area-inset-bottom)` 安全区；`text-size-adjust`/`tap-highlight`；导航/按钮触控目标 ≥44px；11px 小字→12px、图谱边标签 9→11px、远层节点 10.5→11.5px。

### 🖥️ 双端
- `hallmark.css` 补 `:focus-visible` 聚焦环（修 index/generator 键盘焦点缺失）；导航折叠断点统一 960px（main/prep/corpus/knowledge，原 640px）。

### 🐛 修复
- `assistant-model.js` 的 `var(--grad)` 悬空引用（掌握度进度条无色）→ `var(--em)`。

### ✅ 验证
- `npm test` 67/67 通过；`check-all.js` 全绿；外部 JS `node --check` 通过；CSS 变量/悬空引用/身份一致性全查通过。

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
