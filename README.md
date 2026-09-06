# ChemAI — 三草酸合铁(III)酸钾制备实验 智能教学平台

[![Deploy](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://emblulol.github.io/Chemai-demo/)
[![Version](https://img.shields.io/badge/version-v88-blue)](https://github.com/emblulol/Chemai-demo)
[![FAQ](https://img.shields.io/badge/FAQ-4588条-green)](https://github.com/emblulol/Chemai-demo)
[![Corpus](https://img.shields.io/badge/语料库-445篇-orange)](https://github.com/emblulol/Chemai-demo)
[![KG](https://img.shields.io/badge/知识图谱-123节点-blueviolet)](https://github.com/emblulol/Chemai-demo)
[![Videos](https://img.shields.io/badge/本地视频-4部-teal)](https://github.com/emblulol/Chemai-demo)
[![AI 模型](https://img.shields.io/badge/AI神经网络模式-诚实工程架构-green)](./docs/AI模型架构.md)

**ChemAI** 是面向大学化学实验教学的 AI 智能平台，以 **三草酸合铁(III)酸钾 K₃[Fe(C₂O₄)₃]·3H₂O** 制备实验为核心，集成 **LLM-RAG 智能问答、智能体集群、知识图谱可视化、语料库文献检索、掌握度自适应测评、科普探索、本地教学视频、深度问题自学习迭代**等功能。

自 v69 起，AI 助手完成**模型化改造**，输入框上方以 **6 个工作模式 chips** 自由切换：💬 **学习问答**（快速本地答案）/ 🧠 **深度求解**（计划+集群联网）/ 📝 **智能测验**（掌握度测评）/ 🌐 **深度研究**（强制联网检索，多源权威校验）/ 📊 **可视化**（10 类富模板图）/ 🎯 **精通之路**（SM-2 间隔复习 + 学习画像）。集群模式由 5 个智能体（检索官 / 推理官 / 网页研究员 / 编辑官 / 质检官）协作，可在站内题库、PubChem、维基百科、Bing 等来源间**按需联网检索**，并对网页资料与实验讲义做**权威冲突校验**。平台内置 **4 部本地录制教学视频**（制备 / 性质 / 配离子电荷）、**白天 / 夜晚双主题**（导航栏 🌓 一键切换，自动记忆偏好）、面向非化学专业的 **科普探索页** 与 **教师命题大板块**，构建"图文 + 视频 + AI 问答 + 测评"四位一体的学习闭环。FAQ 检索历经 **R2–R15 鉴别力路由修复**（复杂/难题 86 题 100%）与**答非所问根治**，搭配 **MSDS 查询网** 与化学实体特异性识别，确保重要内容不答非所问。

**关于"AI 神经网络模式"的诚实说明**（详见 [`docs/AI模型架构.md`](./docs/AI模型架构.md)）：本平台作答所用的**检索排序不是神经网络**——`searchCorpus` / `matchFAQ` 是一张**手工设定的、无梯度、跨轮次稳定**的权重打分表（语料字段 10/6/6/4/4/3、CONCEPT_BOOST +8、HIT_THRESHOLD=6；FAQ 按 keyScore+entScore+longKey·0.5+lenBonus+titleTopical+distinctHits·2）。全系统**唯一含神经网络**的是 **DeepSeek Transformer 大语言模型**（生成层 + 评分层，托管 API、权重冻结、ChemAI 侧零微调）。v85 起新增**语料权威度权重**：由离线作业 [`训练管道/corpus_weight_analysis.js`](./训练管道/corpus_weight_analysis.js) 读透全部 445 篇文献后，计算每条语料 `A(id)`、子域覆盖度/反挤占 boost，以及"语料子域→权威 FAQ 子域"映射，**加法式/门禁级**注入运行时（不进 `matchFAQ` 基础公式），详见 [`docs/语料权重分析报告.md`](./docs/语料权重分析报告.md)。

**关于 v86 "对齐 demo 精华"**：本版把 `emblulol/Chemai-demo` 里**留而未用**的移动端与主题体验取回本地——① **主题跨页桥接**（SPA 的 `chem-theme` 与静态页的 `chemaiTheme` 两键互通，切主题全站一致）；② **移动端安全区 / 触控目标 / 文字缩放锁定**（`viewport-fit=cover` + `safe-area-inset-*` + 44px 触控 + `text-size-adjust:100%`）；③ **知识图谱手机端字号自适应 + 缩放下限**；④ `color-scheme` meta 全站统一；⑤ **身份切换停留 index**（身份卡点击后原地刷新徽章/门控，不搬 demo 的"自动进手册"跳转）；⑥ 干净化——`kg.json` 删 15 个死字段 `cat`、语料难度 15 条裸 `中` 归一为 `进阶级`；⑦ **去 AI 味·减弱 chrome 特效（保留粒子）**——采纳"毛玻璃/渐变/光晕明显减弱、粒子必留"，导航毛玻璃 blur 20/14→6 去 saturate、导航底更实（`.82`→`.92`）、logo 流光减速（5s→9s）+ 辉光减弱（drop-shadow `.35`→`.15`）、环境光斑更淡更慢（`.16`→`.07`、blur 70→40、46s 漂流）；**字体收敛**——主体弃 Inter/Space Grotesk 统一系统字体栈（PingFang/YaHei/Noto Sans SC），仅保留 **JetBrains Mono**（公式/演示）；**粒子背景全站完整保留**（main/corpus/prep/assistant 走外部 `assets/bg-particles.js`，knowledge 内联，7 页 git diff 无粒子行删减）；⑧ **二遍去 AI 味**——标题渐变流光放慢（`chemaiShine 7/8s`→`40s`、index hero `gradFlow 6s`→`40s`），残留霓虹光晕按半强度收敛（`.stat-num .45`→`.2`、`.badge b .4`→`.2`、`.hl .35`→`.18`、`.panel-title .22`→`.12`、`.g-tag 10px`→`4px`、导航下划线 `.55`→`.3`、卡片悬浮 `.13`→`.06`、标题 drop-shadow `.3/.22`→`.15/.12`）。

---

## 功能模块

| 页面 | 文件 | 说明 |
|------|------|------|
| **首页入口** | `index.html` | React SPA 首页，**命名路由**（`#/report`、`#/explore`…）才接管、裸 `#/` 回落地页；身份选择（非化学专业 / 化学专业 / **教师**），含 LLM 配置面板；**v86 身份切换停留 index**——选身份/切换身份后原地刷新右上角徽章与角色门控，不自动跳 main（`main.html` 手册由「查看实验手册」等导航进入）；**视频资源库页**（`#/videos`）含 4 部本地视频 + 精选 bilibili 教学视频；**科普探索页**（`#/explore`）面向非化学专业，含「实验现象画廊」6 卡与「生活中的化学」4 卡，卡片配图科普 |
| **AI 助手** | `assistant.html` | **6 工作模式 chips**（v69 模型化：💬学习问答 / 🧠深度求解 / 📝智能测验 / 🌐深度研究 / 📊可视化 / 🎯精通之路）；多策略检索 + 类比推理 + DeepSeek RAG 问答；**4588 条 FAQ**（运行时 `data/faq_runtime.js`）+ 鉴别力路由修复 **R2–R15**（复杂/难题 86 题 100%），`matchFAQ` 温度归一化 + 疑问词泛词化**根治答非所问**；**v85 语料权威度 hook**（`loadCorpus` 摄取 `corpus_weights.json` → `searchCorpus` 加法权威 boost + `buildLLMContext` 权威优先 cherry-pick + `relatedFAQs` 子域偏好，全部不进 `matchFAQ` 基础公式）；**5-agent 集群工作台**（检索官/推理官/网页研究员/编辑官/质检官 + 集群日志 + 重答/加强网页检索/LLM重答/集群状态）；**网页研究员**（站内题库/KG→PubChem→维基→Bing·实验性 多源降级，熔断容错，权威冲突校验）；**可视化 10 类富模板**（v72.1 `detectVizType` 分派：异构/晶体场/配合物/装置/热分析/滴定/氧化还原/安全/知识图谱/流程，**有/无 DeepSeek Key 两路径都出图**）；**SM-2 间隔复习 + 学习画像导出**、10 KP 掌握度自适应测评、三维度雷达图 + 学习建议；对话**按身份切换语言风格**（v65，LLM 路径身份镜头统一）；**MSDS 查询网 somds.com** + `detectChems` 化学实体特异性识别；12 条 selfCheck；侧栏**视频资源板块内嵌 4 部本地视频播放器**（默认折叠，点击展开） |
| **主页 / 实验手册入口** | `main.html` | 主页：按「课前 / 课中 / 课后」分组的快捷入口（含 **📖 实验手册**、**操作步骤**、AI助手等），学习路径导引；实验手册全文已迁至 `prep.html`，本页作入口与导览 |
| **教师命题** | `generator.html` | **教师门控命题大板块**：智能生成 + 自主选题 + Word/PDF 导出 + 超星风格分节渲染 + 化学式上下标；答案契约（`referenceAnswer`）＋字母分配，AI 补全选项/难度系数 |
| **知识图谱** | `knowledge.html` | 123 节点 / 195 关联的交互式配位化学知识网络，**高区分 5 色分区配色**（祖母绿/暖橙/玫红/靛蓝/深紫）；**v86 手机端字号自适应 + 缩放下限**，窄屏图谱不被过度缩小、标签随视口宽等比缩放 |
| **语料库** | `corpus.html` | **445 篇**中英文文献知识清单，PDF/PPTX/DOCX 上传解析，子领域分布 + URL 深链；难度字段已归一（v86：400 进阶级 / 7 入门级 / 32 基础级 / 6 提高级，无裸 `中`） |
| **课前预习 / 实验手册** | `prep.html` | 独立承载**实验手册板块**（10 部分 / 11 章 42 节，左侧章节索引粘性侧栏 + 随滚动高亮，LaTeX Unicode 渲染）+ 学习通任务包 + 多轮对话测评 + 习题检测（题库练习 7 大知识方向 · 4 种题型 / 错题本） |

---

## 🎬 视频资源

- **4 部本地录制教学视频**（王志勇·制备、王志勇·性质与配离子电荷、胡锴·制备上/下），**ffmpeg 压缩至 <100MB**（v44 起，720p 重编码后约 29–50MB）后随仓库部署到 GitHub Pages，在线直接播放；
- 分布在两处：**SPA 视频资源库页**（`index.html#/videos`，置顶展示）与 **AI 助手侧栏**"视频资源"板块（本地优先 + bilibili 在线，视频默认折叠点击展开）；
- 原版大文件（~1GB）备份于 `三草酸合铁酸钾资料/三草酸合铁酸钾视频资料/_原版备份/`，不入库。

---

## 深度问题自学习迭代体系

通过 **多 Agent 集群 + 对抗评分代理** 持续生成、审计、修正实验问答与 FAQ，目前运行时 FAQ 累计 **4588 条**，历经 **7 次"重复任务"自训练** + **5 轮门禁循环** + **本会话 30 条工业/实验专项 + self-train 3×100（净增 299）**（详见 [版本历史](#版本历史)）。

### 迭代历程

| 版本 | 新增领域 | 题数 | 评审结果 |
|------|----------|:----:|:--------:|
| v36 | 检漏、滤纸润湿、冷却称量、铁氰化钾检验、倾滗、恒重判据 | 6 | — |
| v36.5 | 步骤顺序错误、操作变异、安全废液、数据处理 | ~40 | — |
| v37 | 浓度梯度、扩散动力学、缓冲化学、界面现象、热历史 | 50 | 含自检 |
| v37.5 | 交叉污染、搅拌模式、H₂O₂浓度、棉线、漏斗、步骤压缩、pH微环境、Ostwald熟化 | 30 | 23/30 ✓ |
| v38 | 温度测量校准、玻璃仪器、时间控制、观察记录、仪器故障、数据报告 | 30 | 4.2/5 |
| v39 | **试剂用量偏差**（逐步骤逐试剂分析 +/- 影响） | 26 | 6✓/19部分/1✗ |
| v40 | **表征分析**（磁化率、蓝晒、热分析、红外、紫外、KMnO₄滴定） | 27 | **27/27 ✓** |
| v41 | **全文献深度学习**（语料库再学习，补蓝晒/摩尔盐/草酸配合物/综合研究）；按实验讲义权威对齐；六集群审计 ~188 处 | 57 新增 | 渲染审计 0 残留 |
| v42 | **基础教科书学习**（Greenwood/Housecroft 教材） | 26 新增 | 校准 11 处 |
| v43 | **语料驱动学术词表 + 关键词清洗**：构建 `academic_lexicon.json`（432 学术词+94 实体词），全库 keys 去泛词 | 23 新增 | 全量校验 0 错误 |
| v45 | **语料库遍历自学习**（3 轮），词表扩至 633 词 + 113 实体 | 78 新增 | 全量检查通过 |
| v46 | **语料库遍历优化迭代 2 遍**（光化学/分析/合成/实验教学/摩尔盐/草酸/综合） | 38 新增 | 全量检查通过 |
| v56 | **智能体集群 + 网页研究员**（FAQ 内容无新增，回答策略升级） | — | 双模式 19/19 冒烟 ✓ |
| v61 | **语料库重整理**（去重 + 103 篇论文补中文摘要 + 规范化），后续迭代 +89 篇文献、99 篇 PDF 全集入库 | 语料库 355→445 | 对照新语料检索 |

### 自学习增强机制

- **对抗评分**：化学正确性 / 定量精确度 / 逻辑完整性 / 教学清晰度 / 实验贴近度 5 维评审
- **双重评审**（v40+）：首轮评分 + 主动质疑 → 复核裁定 + 交叉一致性校验
- **参数锁定校验**：每轮强制对照基准配方（Ksp=3.2×10⁻⁷、6%H₂O₂=1.8M、干燥50°C、失水100°C、Fe=0.01275mol、理论产量6.26g）
- **知识权威层级**：实验讲义 > 文献 > 搜索；数值冲突一律以武汉大学实验讲义为准（v56 网页研究员亦遵循，冲突自动告警）
- **自训练门禁**（v46+）：5 轮循环，全部 ≥9.5 提前结束；重复 ID 自动修复 + precision_finalize 检索兜底

---

## 技术架构

### AI 问答流水线 — 确定性检索-评分层 + 智能体集群

> 检索与排序是一条**手工设定权重的确定性打分表**（无梯度、无反向传播、无 embedding）；真正的神经网络是生成/评分所用的 DeepSeek Transformer LLM（权重冻结）。详见 [`docs/AI模型架构.md`](./docs/AI模型架构.md)。

```
用户提问
  ↓
阶段 1：确定性检索-评分层【层1 · 手调权重 · 无学习】
         ├─ searchCorpus：字段 10/6/6/4/4/3 + CONCEPT_BOOST +8/子域 + 反馈净重 + 语料权威度 A(id)·boost（v85，加法）
         ├─ matchFAQ：keyScore + entScore + longKey·0.5 + lenBonus + titleTopical + distinctHits·2
         │          （+200 exactQ、×0.12 OP_RE、×0.03 OTHER_OX、√FH_THRESH、IDF/GENERIC/CHEM_NOUN）
         └─ confidenceScore / relatedFAQs（子域偏好 v85）/ bestOnTopicFAQ
  ↓
阶段 2：类比推理引擎（24 组跨体系概念映射）+ 确定性计算层【层2 · lib-calc.js 公式引擎】
  ↓
阶段 3：置信度评分 + 混合答案生成（FAQ / 类比 / LLM / 网络回退）
  ↓
阶段 4：自检（12 条验证规则）
  ↓
阶段 5：网页研究员（集群模式 · 站内→PubChem→维基→Bing 多源，熔断降级）
```

> - **层1 确定性检索-评分层**：`searchCorpus` / `matchFAQ` 权重全是代码常数，跨轮次稳定；权威度 boost 走**加法式**（只在已命中条目 `.a×≈4`），不改 `matchFAQ` 基础公式。
> - **层2 确定性计算层**：`scripts/lib-calc.js` 对任意输入按公式当场计算产率/摩尔质量/结晶水/滴定/RSD/磁矩，不背诵 FAQ 示例值。
> - **层3 DeepSeek Transformer 生成层**（唯一神经网络）：`api.deepseek.com/v1/chat/completions`，`model=deepseek-chat` 默认 / `deepseek-v4-flash`，`temp 0.2`、`max_tokens 1000`、SSE、重试×3；`buildLLMContext` 取 matchFAQ top-1 + searchCorpus 权威优先 top-2。
> - **层4 LLM-as-Judge 自学习门禁**：`_score_baseline.js` GATE=9.5 + `run_pipeline.js` 五智能体（RUBRIC 准确 30/完整 20/化学规范 15/来源 15/清晰 10/安全 10=100）+ `self_train.js` 三优化循环。

由 **6 个工作模式 chips** 驱动（输入框上方切换，localStorage 记忆，默认学习问答），每个模式经 `MODE_RECIPES` 声明 `cluster/web/llm/plan/stream/route` 参数，自动派生「正常 / 集群」行为（`cluster:true` 即进入 5-agent 集群工作台）：
- **集群模式**（深度学习 / 深度研究触发）：5-agent 集群工作台 + 按置信度自适应联网检索（低置信度自动触发；含"搜索/查一下/pubchem"等词手动触发），支持 重新生成 / 加强网页检索 / LLM重答 / 集群状态 操作；对话按用户身份（学生/教师等）切换语言风格。
- **非集群模式**（学习问答 / 智能测验 / 可视化 / 精通之路）：快速本地答案（RAG + 类比 + 可选 LLM）+ 各自路由（智能测验→assessment、精通之路→mastery、可视化→10 类富模板）。
- **权威层级**：实验讲义 > 文献 > 搜索；网页研究员对站内语料标「站内语料」、对外部网络标「网络资料」，与讲义冲突时黄字警示、以讲义为准。

### 主题与移动端体验（v86）

- **主题跨页桥接**：静态页读 `localStorage.chemaiTheme`（裸 `'dark'/'light'`），React SPA 用 Zustand persist 键 `chem-theme`（`{"state":{"theme":…},"version":0}`）。`index.html` 内的桥接脚本在加载时把权威键 `chemaiTheme` 灌进 `chem-theme.state.theme`（保留 `version` 与其余 state 字段），并用 `MutationObserver` 监听 `<html data-theme>` 变化回写——用户在 SPA（`#/videos` 等）或任一静态页切主题，全站保持一致，不再断链。
- **移动端显示优化**（`assets/mobile-content-guard.css` 追加块）：`text-size-adjust:100%` 锁定文字缩放；`padding-bottom:env(safe-area-inset-bottom)` / `.navbar` `padding-top:env(safe-area-inset-top)`（配合 7 页 `viewport-fit=cover`）；≤820px 下导航/发送钮 **≥44px**、图例折叠/缩放钮 **≥40px**、中文 11→12/13px。
- **知识图谱手机端**（`knowledge.html`）：`fsScale = min(1, max(0.75, W/700))` 标签字号随视口宽等比缩小；`scale = max(0.45, ·/1400)` 缩放下限防窄屏图谱过度缩小。
- **身份切换停留 index**（`index.html`）：身份卡点击后写入 `chem-user` 并原地 `applyRole` 刷新右上角徽章与 `[data-role-gate]` 门控，停留在 index（不自动跳 `main.html`）；`#/report` 等命名路由不受影响。

### 三页深度链接闭环

```
AI 助手 ──文献卡片/引用──→ 语料库（精确定位条目）
    ↑                          ↓
    └──知识延伸── 知识图谱 ──文献关联──┘
```

---

## 项目结构

```
chemai-8.23-/
├── index.html                 # 首页入口（React SPA，命名路由 + v86 身份切换停留 index + 主题桥接，含视频资源库页 + 科普探索页）
├── assistant.html             # AI 助手（4588 FAQ + 6 工作模式 + 智能体集群 + 10 类可视化 + 测评 + 语料权威度 hook）
├── main.html                  # 主页/入口（按课前课中课后分组快捷入口 + 学习路径；实验手册全文在 prep.html）
├── generator.html             # 教师命题大板块（教师门控，智能生成 + 自主选题 + Word/PDF 导出）
├── knowledge.html             # 知识图谱（123 节点 / 195 关联，5 色分区 + 手机端字号自适应）
├── corpus.html                # 语料库（445 篇，难度字段已归一）
├── prep.html                  # 课前预习
├── docs/
│   ├── AI模型架构.md          # AI「神经网络模式」说明（诚实的工程架构）
│   ├── 语料权重分析报告.md    # 语料权威度权重分析报告（离线作业生成）
│   ├── knowledge-reextract-report.md # 语料知识清单再检索报告（v85，540 数值句 + 14 条权威事实）
│   ├── CHANGELOG_v35.md / 训练数据与成绩总览.md / MEMORY.md # 变更/训练统计/开发备忘
├── assets/
│   ├── assistant-model.js    # v69/v72 助手模型（IIFE：6 工作模式 MODE_RECIPES + 10 类可视化构建器 + SM-2 复习 + loadKG）
│   ├── agent-cluster.js      # 网页研究员模块（v56，自包含 IIFE：站内/PubChem/维基/Bing 多源+熔断+冲突校验）
│   ├── index-B-pT4Snc.js     # SPA 编译产物（已注入本地视频 / 科普探索页插图）
│   ├── mobile-content-guard.css # 移动端富内容兜底 + v86 安全区/触控/text-size-adjust 块
│   ├── images/              # 实验实拍图 + 科普探索页插图（assets/images/explore/）
│   └── ...                   # CSS / JS
├── data/
│   ├── faq_runtime.js        # 运行时 FAQ（v37.6+ 唯一真相源，4588 条，window.FAQ=）
│   ├── manual.json           # 实验手册（11 章 / 42 节）
│   ├── corpus.json           # 语料库清单（445 篇；难度归一 400 进阶级/7 入门/32 基础/6 提高）
│   ├── corpus_weights.json   # 语料权威度权重（离线生成，v85；`npm run corpus:weights`）
│   ├── corpus_authoritative_facts.json # 14 条语料权威事实（v85，注入 faq_runtime.js）
│   ├── kg.json               # 知识图谱（123 节点；v86 删 15 个死字段 cat）
│   ├── categories.json       # 权威 17 官方案 + ~70 别名（子域归一 + faqMapping，已部署）
│   ├── images.json           # 实验图片索引（76 张）
│   ├── questions_bank.json / report_rubric.json
│   └── academic_lexicon.json # 学术词表（dev-only，不部署）
│   # 其余 dev-only（不部署）：kb.json（遗留知识块）、questions_master.json（题库池）、
│   #   assessment_kp.json、lexicon_sources_dump.json、all_cycle_questions.json、faq_key_blacklist.json
├── scripts/                   # 工具脚本（lib-assistant-faq.js、lib-calc.js 通用计算引擎、v44/v66/v67/v68-inject-*.js、v45-round.js 等）
├── 训练管道/
│   ├── corpus_weight_analysis.js  # 语料权威度离线作业（读透 445 篇，输出 corpus_weights.json + 报告）
│   ├── corpus_extract_facts.js    # 语料数值句只读抽取（v85，输出 540 句 + 14 条权威事实）
│   ├── inject_authoritative_facts.js # 语料权威事实幂等注入器（v85，纯追加到 faq_runtime.js）
│   ├── local_answer.js            # 答题路径无头官方复刻（逐字镜像 assistant.html，供回归/评分）
│   └── _score_baseline.js         # 阶段四基准评分：round4 题本地回复 → LLM 评分（门禁 9.5）
├── Agent工作区/ 试题迭代记录/
├── 三草酸合铁酸钾资料/        # 原始语料 + 视频资料（含 _原版备份）
├── _archive/                  # 历史归档：调试脚本(7组)/报告与诊断/数据备份/临时产物/资料汇编/杂项 + js/jpg/json/...
├── .github/workflows/deploy.yml  # Actions 备用部署（手动触发）
└── README.md / DEPLOY.md
```

---

## 已知限制

- **SPA 落地页内嵌手册为历史快照**：`assets/index-B-pT4Snc.js`（React 落地页构建产物）内嵌旧 12 章版实验手册（含已删除的「实验报告撰写规范」章），与 `prep.html` 的动态手册（11 章）分叉。React 源码未随仓库维护，暂不重建；**实验手册以 `prep.html` 为准**。
- **本地视频部署依赖分支构建**：4 部本地视频位于 `三草酸合铁酸钾资料/三草酸合铁酸钾视频资料/`，是否在线可播取决于部署机制（内置「Deploy from a branch」会发布整个仓库根目录；`deploy.yml` 的 `_site` 精简组装不含该文件夹）。
- **站点已改用仓库默认 Pages 地址**：`https://emblulol.github.io/Chemai-demo/`（已移除自定义域名 CNAME）。
- **网页研究员依赖 CORS 网络**：PubChem / 维基百科为 CORS 开放接口可直连；Bing 经第三方代理（实验性，熔断自动停用）；知网/万方/百度学术/ChemicalBook 无浏览器 CORS，仅提供搜索链接兜底；**MSDS 查询网 / ChemicalBook / PubChem 为外链跳转**（`msdsCardHTML` 前置 somds.com）。
- **教师命题依赖题库数据**：`generator.html` 的智能生成/自主选题基于 `questions_master.json`（题库池），为 **dev-only 未部署**；且 `.github/workflows/deploy.yml` 的精简 `_site` 组装清单不含生成器与题库——实际上线依赖「从 master 分支构建」发布整仓（`data/` 已含题库则可用，否则生成器功能依赖线上题库存在）。
- **身份切换停留 index**（v86）：身份卡点击后停留 index 原地刷新身份（徽章 + 角色门控），不再自动跳 main；`main.html` 手册通过导航「查看实验手册」进入。`chem-user` 身份跨页共享（index 与 main 读同一键）。

---

## 快速开始

```bash
cd chemai-8.23-
python -m http.server 8080      # Python
# 或
npx serve .                     # Node.js
# 浏览器打开 http://localhost:8080/
```

> ⚠️ 必须通过 HTTP(S) 访问（`file://` 会导致 JSON 加载失败）；本地视频在 `file://` 下可正常播放。

### 启用 LLM

在「AI 助手」页面左侧 **🤖 LLM AI 配置** 面板粘贴 DeepSeek API Key 即可；不配置则自动回退本地检索 + 类比推理模式。离线训练/评分（`npm run pipeline`、`node 训练管道/_score_baseline.js`）走 DeepSeek 托管 API，需要 `DEEPSEEK_KEY` 环境变量；`npm run corpus:weights` 为纯离线确定性作业，**无需任何 key**。

### 体验集群模式

在 AI 助手输入框上方切换到 **🧠 深度求解**（或 🌐 深度研究），然后提问（如"蓝晒的剂量计原理查一下"）——观察 5 个智能体依次工作、网页研究员联网返回站内/网络资料、质检官校验权威冲突；切到 **📊 可视化** 可看到 10 类富模板图（流程图 / 晶体场 / 抽滤装置 / TG-DSC / 知识图谱等）。

---

## 部署

- **实际部署**：站点由 GitHub 内置 **「从 master 分支构建」Pages 服务** 发布——向 `master` 推送即自动重建，**部署分支里所有已提交文件**（含 `assets/`、`data/`、视频、`docs/`、`scripts/lib-calc.js` 等）。未提交的 untracked 文件不会上线。
- **Actions 备用**：`.github/workflows/deploy.yml` 为手动触发的精简 `_site` 组装（7 页面 + assets + 10 个运行时 data + `scripts/lib-calc.js` + `CNAME`），**不是实际部署源**；除非在仓库 Settings→Pages 将 Source 从「Deploy from a branch」切换为「GitHub Actions」，否则改它不影响线上。
- **验证部署**：推送后约 2–3 分钟重建生效；可用线上 `assistant.html` 的 git blob 哈希与仓库 HEAD 对比确认。
- **本地生成权重**：改动 `data/corpus.json` 或 `data/categories.json` 后，先 `npm run corpus:weights`（= `node 训练管道/corpus_weight_analysis.js`，无需 LLM）再部署，否则运行时语料权威度未更新。
- 详见 [DEPLOY.md](./DEPLOY.md)。

---

## 版本历史

> 版本线 v30 → v88（2026-07 至 2026-09）。v45 起版本号由「语料自学习轮次 + UI 注入脚本」共同承载；v85 起含「语料权威度权重 + AI 模型架构文档 + 部署补齐」；v86 起取回 demo 精华做体验对齐；v87 起含「工业/实验专项问答 + 检索门回归修正 + 学习式重排对比实验」；v88 起含「主页/实验手册一体化 + 题库版式修正 + 助手换问法压测」。

### 近期（v74 → v86）

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| **v88** | 09-04 | **主页/实验手册一体化 + 题库版式修正 + 助手换问法压测（本交付）**：① **实验手册集约到 `prep.html`**——完整手册（10 部分 / 11 章 42 节）独立板块，`main.html` 变入口：课前组新增「📖 实验手册」卡、课中卡改「操作步骤」（删旧标题 4 字），模块计数 9→10、删冗余 `.manual-head`/`#manualBox` 块；② **手册板块排版**——改「左里章节索引 + 内容」双栏（对齐页面 1280px），章节索引为粘性侧栏并**随滚动高亮**（对齐主站 toc 的 initSpy 风格），修复全部 `#partNN` 断链与"异步渲染后锚点落位"，宽高/留白对齐其它模块；③ **修复手册内容渲染双重转义**——`inline()` 此前先整体 `esc()` 再交由 `renderFormula` 二次转义，导致 `>`/`<`/`&` 显示成裸 `&gt;`/`&lt;`（如 `Δ₀ > P`、`\xrightarrow{>200°C}`）；改为只转义散文、数学段各转一次，实测 0 段残留（`render-audit` 无关）；④ **题库练习版式/文案对齐实时题库页**——134 题/5 方向/2 题型 → **7 大知识方向 · 4 种题型** + 4 种练习模式 chips，题目数改为计数无关"百余道"；⑤ **助手换问法压测（多 Agent 集群，5 轮 + 终验）**——A 换问法→B 捕获本地命中→C 以**讲义为绝对权威**、**精准度绝对优先**比对→D 安全补 key：共测 15 个等价改写问法，初始仅 **7%** 命中（揭示 `matchFAQ` 对措辞脆弱），按精准度人工复核后安全补 key（6 条目 +10 词，如 `氯化铁`/`对光敏感`/`三水合物`；拒绝 `哪三样`/`高自旋`/`用场` 等泛词），修复后 **13%**，无回归（条目数 4588 稳定、讲义侧 `faq_verify` 15/15 仍全命中、`render-audit` 0 问题）；新增确定性工具 `scripts/assistant_capture.js`、`scripts/assistant_apply_keys.js`。✅ 各页内联脚本解析 0 错误、无乱码 |
| **v87** | 09-02/03 | **工业/实验专项问答 + 训练 + 检索门回归修正 + 学习式重排对比实验**：① **30 条工业/实验问答**（三价铁能否作铁源、工业制备三草酸合铁酸钾、摩尔盐选择、实验室vs工业差异、母液回收、磁矩/高自旋等，含权威数值 45℃/91.6%、磁矩 5.92、烘干50℃/失水~100℃、铁13.09wt%/草酸根53.9wt% 等），均以**真实已有 corpus#id 文献锚定**（不凭空造文献）；② **self-train 3×100**（`self_train_loop.js`，判官门禁≥9.5 + `ensureCoverage` 确定性补录 + `cleanArtifacts`），FAQ 4545→4547，全库审计 **98.0%→98.8%**（4356 题，无命中 78→39，低置信 0）；③ **DOMAIN_RE 检索门放宽再修**——单靠放宽会引进离题误命中，改为**只留化学专属词**（磁矩/Gouy/Jahn/稳定常数/配体场/配离子/异构体/TG-DSC/离子交换/普鲁士蓝等），删风险词（电荷/异构/再生/热重/自旋/树脂/畸变/失重），离题零误命中、化学缺口保留；④ **学习式 MLP 重排器对比实验**（`训练管道/mlp_reranker.js`，202 参数、从零 Adam/反向传播、无暴露标注）——**结论：手工 `matchFAQ` 获胜**（改写题全库 3.9% vs 17.3%、原题 39.2% vs 95.3%），**保留手工检索**，神经网络为研究记录（静态站无推理后端，与架构文档一致）；由多 Agent 集群（改进×2 + 对抗质疑×2）完成"构建 vs 质疑"双线并行。✅ validate 0 错误、verify_web_ready 全绿、无乱码 |
| **v86** | 09-01 | **对齐 demo 精华（本交付）**：取回 `emblulol/Chemai-demo` 留而未用的体验功能，本地与线上已成并行分叉、互有取舍，此版专搬"本地回退/未做而 demo 保留"的部分，**不搬**会回归本地的 v73 身份/引导/管理员架构、hallmark 样式覆盖层、level4→level3 归并。① **主题跨页桥接**——`index.html` 加桥接脚本：加载时把权威键 `chemaiTheme` 灌进 SPA 的 `chem-theme`（Zustand persist，保留 `version` 与其余 state，只覆写 `state.theme`），并用 `MutationObserver` 监听 `<html data-theme>` 回写，静态页与 SPA（`#/report|explore|quiz|generator|videos|agent`）切主题全站一致，消除"经 SPA 切主题回静态页断链"；② **移动端安全区/触控/文字缩放**——`assets/mobile-content-guard.css` **合并补回** demo 手机端块（`text-size-adjust:100%`、`body padding-bottom:env(safe-area-inset-bottom)`、`.navbar padding-top:env(safe-area-inset-top)`、≤820px 导航/发送钮≥44px、图例/缩放钮≥40px、中文 11→12/13px），**保留本地已有的全宽 overflow-wrap 规则**（合并非覆盖），7 页 viewport meta 补 `viewport-fit=cover`；③ **知识图谱手机端**——`knowledge.html` 加 `fsScale=min(1,max(0.75,W/700))` 标签字号随视口宽等比缩小 + `scale=max(0.45,·/1400)` 缩放下限，`wf` 三处乘 `fsScale`，窄屏图谱不被过度缩小；④ **color-scheme meta 全站统一**——6 页 `<meta name="color-scheme" content="dark light">`；⑤ **身份切换停留 index**——身份卡点击后写入 `chem-user` 并原地 `applyRole` 刷新右上角徽章与角色门控，停留 index 不跳 main（采纳用户意见：切换身份应落在 index，撤 demo 的"身份识别一次自动进手册"重定向与 `getChemRole` 全局）；⑥ **干净化**——`kg.json` 删 15 个死字段 `cat`（全项目无代码读 `node.cat`，行级删除保留多行数组格式）、`corpus.json` 15 条裸 `中` 难度归一为 `进阶级`（400 进阶级/7 入门/32 基础/6 提高；前端不显示语料难度，`gap-analysis` 对其优先级由 3 升 0）；⑦ **去 AI 味·减弱 chrome 特效（保留粒子）**——对齐 demo 观感：导航毛玻璃 `blur(20/14px)`→`blur(6px)` 去 `saturate(1.5)`、导航底更实（`rgba(10,14,26,.82)`→`.92`）、logo 流光 `chemaiFlow 5s`→`9s` + 辉光 `drop-shadow(0 0 5px .35)`→`drop-shadow(0 0 1px .15)`、环境光斑 `rgba(16,185,129,.16)`→`.07` 且 `blur(70px)`→`blur(40px)`、`chemaiDrift 26s`→`44s`；**字体收敛**——主体弃 Inter/Space Grotesk 统一系统字体栈（PingFang/YaHei/Noto Sans SC），仅保留 JetBrains Mono（公式/演示）；**粒子背景完整保留**（main/corpus/prep/assistant 走外部 `assets/bg-particles.js`，knowledge 内联，7 页 git diff 无粒子行删减）；⑧ **二遍去 AI 味·残余渐变光晕收敛**——标题渐变流光 `chemaiShine 7/8s`→`40s`（近乎静止）、index hero `gradFlow 6s`→`40s`，残留霓虹光晕按半强度收敛（`.stat-num .45`→`.2`、`.badge b .4`→`.2`、`.hl .35`→`.18`、`.panel-title .22`→`.12`、`.g-tag 10px`→`4px`、导航下划线 `.55`→`.3`、卡片悬浮 `.13`→`.06`、标题 drop-shadow `.3/.22`→`.15/.12`）；⑨ **assistant 问题排版**——"可能问题"chips（顶部 `MODE_CHIPS` 建议 + 答案内"你可能还想问" + 角色追问）共用 `.chip`，加 `line-height:1.55`/`white-space:normal`/`max-width:100%`（长问法多行换行不溢出）、`.chips` 容器 `align-items:center`、手机端 `.chip{min-height:40px;padding:8px 14px;font-size:12.5px}`（触控高度由 ~27px 提至 40px）；⑩ **assistant 答案文段分布**——答案文本以 `\n`（单换行）分隔各叙述句、`\n\n` 切段，但 `.ans-line`（单`\n`句）无 margin 与 `.ans-eq`(4px)/`.ans-head`(10/4)/`.ans-block`(9px) 节奏不一致，叙述句紧贴成一坨；现给 `.ans-line{margin:3px 0}`，形成"单`\n`微距 < 段距(9px) < 方程/标题"的清晰层级（纯 CSS，未动 `renderRichAnswer`，render-audit 0 段问题）。✅ 6 改动页内联脚本全解析 0 失败、kg/corpus JSON 校验通过、level4 9 节点未归并 |
| **v85** | 09-01 | **全局优化 + 语料权威度 + AI 模型文档 + 部署补齐**：① **读透全部 445 篇语料**——离线确定性作业 `训练管道/corpus_weight_analysis.js`（`npm run corpus:weights`）计算权威度 `A(id)` + 子域反挤占 boost，产出 `data/corpus_weights.json` + `docs/语料权重分析报告.md`；② **加法式/门禁级运行时 hook**——`loadCorpus`→`searchCorpus` 加法 boost + `buildLLMContext` 权威优先 cherry-pick + `relatedFAQs` 子域偏好，不进 `matchFAQ` 基础公式；③ **AI 模型文档** `docs/AI模型架构.md` 诚实说明检索排序非神经网络、唯一神经网络是 DeepSeek；④ **README 重写**；⑤ **部署补齐**——`deploy.yml` 补 `generator.html`/`data/categories.json`/`data/corpus_weights.json`/`scripts/lib-calc.js`，`package.json` repository.url 修正 |
| **v74** | 08-25 | **assistant 助手重构落地（v72/v72.1 全部项）**：① **LLM 质检兜底**——`llmAnswerText` 记录 LLM 全文，`selfCheck`/讲义核对运行对象改 `usedLLM?llmAnswerText:html`；② **async 管道**——答案注入包装 `injectDone` Promise，`Promise.all([injectDone,webP,skillP])` 消除竞态；③ **置信度口径**——`faqConfidence()`(0.5~0.95) 替换「命中即0.9」；④ **知识图谱深链**——`SUBFIELD_ALIAS`+`resolveNodeTarget`+`resolveDeepLink`，图谱官返回 `?node=<id>` 深链；⑤ **安全**——上传包裹 `<user-file name>`+system prompt 防提示词注入、PDF 解析改本地 vendor；⑥ **代码清理**——删死代码、合并 DOMAIN_RE |

### 精致化（v44 → v73）

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| **v73** | 08-25 | **FAQ 答非所问内容轮**（纯 `data/faq_runtime.js` 数据修复，21 对抗题全命中）：数值纠偏（莫尔盐 5.0g、H₂O₂ 8mL、双氧水 6%、草酸 0.5mol/L）、跨实验机理-vs-操作错配、错配合物修正、trim 裸键治 title-topical 磁吸 |
| **v72.1** | 08-25 | **assistant 可视化再扩展 + 答非所问根治 + MSDS 查询网**：可视化扩至 **10 类富模板** + **双路径出图**（配 Key 与本地都出图）；`matchFAQ` 温度归一化 + 疑问词泛词化 + `bestOnTopicFAQ` 宽松兜底 + `onTopic` 域内门控；MSDS 前置 somds.com；`detectChems` 补草酸钾/草酸亚铁独立条目 |
| **v72** | 08-25 | **assistant 可视化增强**：5 类富模板 + 双路径出图 + `.visual` 响应式；**LLM 路径身份镜头统一** |
| **v71.1** | 08-23 | **assistant 体验打磨 + FAQ 鉴别力路由修复**：R2–R10 + 复杂/难题 R11–R15（86 题 100%） |
| **v71** | 08-23 | **学术追踪 + 知识星链**：corpus 页「📡 学术追踪·领域动态」+ 年份趋势 chips + 🔗 知识星链 |
| **v70** | 08-23 | **闻道三功能**：知识库多源枢纽、收藏+笔记、多文献横向对比（`AUTHORITY_RULES` 加只读 `param`/`lecture` 字段） |
| **v69** | 08-22/23 | **助手模型化改造**：`assets/assistant-model.js` 6 工作模式 + 打字机流式渲染 + 计划/可视化/精通之路仪表盘 + SM-2 间隔复习 + 学习画像导出 |
| **v68** | 08-22 | **科普探索页图片防畸变 + 光敏材料/催化剂补图** |
| **v67** | 08-22 | **科普探索页卡片插图**（画廊 6 卡横幅 + 生活化学 4 卡缩略图） |
| **v66** | 08-22 | **AI 助手移动端输入框解放 + 侧栏视频懒加载提速** |
| **v65** | 08-21 | **助手按身份切换语言风格** |
| **v64** | 08-21 | **全站背景粒子氛围** |
| **v63** | 08-21 | **全站「落地页同级」精致化** |
| **v62** | 08-21 | **可视化内容渲染按需加载** + 查看实验手册默认化学专业身份 |
| **v61** | 08-20/21 | **语料库重整理与扩容**：去重 + 103 篇论文补中文摘要 + 规范，语料库 355→445；**知识图谱细化至 123 节点/195 关联**（5 子域深挖 + 15 稀疏补齐）；图谱配色改高区分 5 色分区 |
| **v60.1** | 08-20 | 问答提速 2.5× + 修复 BOM 编码污染 |
| **v60** | 08-20 | **服务实验深化：讲义权威进主路径 + 实验服务技能 + 数据一致性修复**；数据一致性以讲义 PDF 为基准修正（失水 100℃、8mL 6%H₂O₂、10mL K₂C₂O₄） |
| **v57–v59** | 08-18/20 | （补录）v57 网页研究员双途径 + questions_bank 修正；v58 集群技能库；v59 题库驱动 FAQ 优化 + matchFAQ 精准度根治 |
| **v56** | 08-18 | **AI 助手智能体集群化 + 双模式**：`assets/agent-cluster.js` 网页研究员 + 5-agent 集群工作台 |
| **v55** | 08-17 | **精致化重构**：修复 `--em` 缺失、7 色彩虹标题收敛为品牌三色流光、浅色主题精致化 |
| **v54** | 08-16/17 | **令牌覆盖式样式（被否决，未上线）** |
| **v53** | 08-16 | **知识图谱主题对比度 + 移动端去拥挤**（仅 knowledge.html） |
| **v52** | 08-16 | **全局显示效果**：环境光斑、毛玻璃导航栏、渐变滚动条、键盘焦点环、卡片彩色光晕 |
| **v51** | 08-16 | **艺术字 + DOMAIN_RE 紧急修复** |
| **v50** | 08-16 | **全局版面与可视化**：渐变进度条辉光、评分等级徽章、统计数字渐变、图表玻璃面板 |
| **v49** | 08-15 | **全面审计优化**：修复 assistant 移动端横向溢出、tab 窄屏滚动；v49b 网格 `minmax(0,1fr)` 根治溢出 |
| **v48** | 08-15 | **按键边界清晰化**（5 页） |
| **v47** | 08-15 | **动态效果强化**（5 页）；计算工具/错题本面板移入主栏 |
| **v46** | 08-15 | **全局版面美化 + 语料迭代 2 遍**（卡片悬浮光效、滚动显现动画、减动效适配）；FAQ 1017→1055 |
| **v45** | 08-15 | **语料库遍历自学习 + assistant 功能包**：FAQ 939→1017；学术词表 633 词 + 113 实体；白天/夜晚双主题；24 处乱码修复；`check-all.js` 一键审计 |
| **v44.1/v44** | 08-14/15 | **白天模式修复**；**视频部署 + 界面美化**（4 部本地视频 ffmpeg 压缩 <100MB 入库、SPA 视频库页 + 侧栏播放器、ChemAI 艺术字、corpus.json 补 10 条 total 365） |

### 语料自学习（v36 → v43）

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| **v43** | 08-14 | **第三轮语料自学习**：`academic_lexicon.json`（432 学术词/94 实体词）；全库 916 条 FAQ keys/ents 清洗；gap 分析补 23 条（FAQ 916→939） |
| **v42** | 08-13 | **基础教科书学习**：Greenwood/Housecroft 教材 +26 条，校准 Δo(oxalate)、d-d 自旋禁阻等 11 处 |
| **v41** | 08-13 | **全文献深度学习 + 权威对齐**：+57 条 FAQ（833→890）；按武汉大学讲义全库对齐；六集群审计修正 ~188 处 |
| **v40** | 08-12 | 表征分析深度问答 27 题（**27/27**）；语料库 291→355；知识图谱深链关联；引入双重评审 |
| **v39** | 08-12 | 试剂用量偏差专项 26 题 |
| **v38** | 08-12 | 深度问答 v2：30 题对抗评审（avg 4.2/5） |
| **v37.5** | 08-11 | 自学习循环 v1：30 题，23/30 |
| **v37/v37.6** | 08-11 | 50 条自检深度 FAQ；**FAQ 外置**（运行时 FAQ 移出 assistant.html → `data/faq_runtime.js`，首屏 3.8MB→202KB） |
| **v36.5/v36** | 08-11 | 步骤顺序/操作变异/安全废液/数据处理 ~40 题；深度操作 FAQ 6 题 + selfCheck 3 条 |

### 架构奠基（v30 → v35）

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| **v35** | 08-11 | **v33 以来最大规模迭代**（80+ commits）：编码稳定性（UTF-8 BOM 损坏恢复、死代码清理）；答案格式（置信度徽章/精简文献卡）；答案精确度（matchFAQ IDF 高频惩罚表、temp 0.3→0.2、selfCheck 3→9、110°C→50°C 烘干温度 20+ 处修正）；数据治理；视频库 4→17；评估 8→10 KP |
| **v34** | 08-08→11 | （过渡版本，无独立内容记录） |
| **v33** | 08-08 | 智能体集群、知识图谱 82→97 节点、LaTeX 渲染 |
| **v32.5** | 07 底 | 实验手册精简、苏格拉底自适应测评 + SVG 雷达图 |
| **v32** | 07 底 | 知识图谱 55→77 节点、评估 8→12 KP |
| **v31** | 07 中 | 共享 RAG 模块、FAQ 验证、KG 同步 |
| **v30** | 07 中 | 6-dim 评分、700 FAQ、30 周期训练 |

### FAQ 自训练增长链（"重复任务"时间线）

FAQ 累计 4588 条的演进路径（含跨版本的自训练轮次）：

| 阶段 | FAQ 数 | 说明 |
|------|:------:|------|
| v41 → v43 | 833 → 939 | 全文献/教科书/词表三轮深度学习 |
| v45 | 939 → 1017 | 语料库遍历自学习（3 轮，+78） |
| v46 | 1017 → 1055 | 语料库遍历优化迭代 2 遍（+38） |
| 自训练 1–5 次 | 1055 → 2649 | 200 道深度题循环（5 次全部 200/200 ≥9.5，avg 9.78） |
| 第 6 次 | 2649 → 2846 | 199/199 ≥9.5，assistant 同步 v55 |
| 第 7 次 | 2848 → 3047 | **循环内首次直接过门禁**（199/199 ≥9.5） |
| v60 后（推算） | 3047 → 3102 | 语料库扩容 + 深度问题自训练累计 |
| 5 轮门禁收尾 | → 3102 | 门禁 9.5：avg 4.28→9.92，final 199/199 avg 9.97 |
| v72.1–v85 内容/权威轮 | 3102 → 4211 | 答非所问内容轮（v73 对抗 21 题全命中，v72.1 离线误中 5→2，v74 质检兜底/置信度重构）+ 语料权威度 hook（v85）+ v44/v66/v67/v68 后续注入累计（4211，运行时唯一真相源） |

> 自训练门禁（v46+）：`训练管道/self_train.js` 5 轮循环，出题→审核→本地回复→评分（门禁 9.5）→3 优化（检索/答案/覆盖）→确定性覆盖补录，全部 ≥9.5 提前结束；重复 ID 由题目文本对齐修复。

---

## 致谢

- 武汉大学化学与分子科学学院
- 语料库收录的所有文献作者与期刊
- 王志勇、胡锴等提供的本地教学视频

---

## 许可证

本项目仅用于教育和研究目的。语料库中的文献版权归原出版方所有；代码部分采用 MIT License。
