#!/usr/bin/env node
/**
 * refine-kg.js — 知识图谱细化合并 + 校验工具（dev-only）
 *
 * 从 data/kg.json + _archive/data_dev/kg_refine.json 合并新增节点/边、补齐稀疏节点，
 * 校验 id 唯一 / category 合法 / parent 与 relatedNodes / source / target 引用存在，
 * 以 JSON.stringify(kg,null,2)+"\n"(LF, 2 空格) 写回。
 *
 * 用法：node scripts/refine-kg.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const KG = path.join(ROOT, "data", "kg.json");
const REFINE = path.join(ROOT, "data", "kg_refine.json");

const VALID_CAT = new Set(["center", "coordination", "redox", "analytical", "physical"]);
const VALID_LINE = new Set(["solid", "dashed"]);

// ---------- 读取 ----------
const kg = JSON.parse(fs.readFileSync(KG, "utf8"));
const rf = JSON.parse(fs.readFileSync(REFINE, "utf8"));

// ---------- 统计 ----------
const nodesBefore = kg.nodes.length;
const linksBefore = kg.links.length;

// ---------- 辅助 ----------
const idSet = new Set(kg.nodes.map((n) => n.id));
const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function refOf(arr, label) {
  if (arr === undefined || arr === null) return;
  if (!Array.isArray(arr)) { fail(`[${label}] 应为数组`); return; }
  for (const r of arr) {
    if (typeof r !== "string") fail(`[${label}] 含非字符串引用`);
    else if (!idSet.has(r)) fail(`[${label}] 引用了不存在的节点 id：${r}`);
  }
}

// ---------- 1. 新增节点 ----------
const addNodes = rf.addNodes || [];

// 1a. 先把所有新增节点 id 注册进 idSet（relatedNodes/parent 可能指向同批的兄弟新增节点）
for (const n of addNodes) {
  if (!n || typeof n.id !== "string") { fail("存在无 id 的新增节点"); continue; }
  if (idSet.has(n.id)) fail(`新增节点 id 重复：${n.id}`);
  idSet.add(n.id);
}

// 1b. 再统一校验字段
for (const n of addNodes) {
  if (!n || typeof n.id !== "string") continue;
  if (!n.name) fail(`节点 ${n.id} 缺 name`);
  if (!VALID_CAT.has(n.category)) fail(`节点 ${n.id} category 非法：${n.category}`);
  if (typeof n.level !== "number" || n.level < 0 || n.level > 4) fail(`节点 ${n.id} level 非法：${n.level}`);
  if (!n.description) fail(`节点 ${n.id} 缺 description(富字段)`);
  refOf(n.relatedNodes, `节点 ${n.id}.relatedNodes`);
}

// 统一校验 parent（含指向新增节点的情况）
const allIds = new Set(idSet);
for (const n of addNodes) {
  if (n.parent && !allIds.has(n.parent)) fail(`节点 ${n.id}.parent 指向不存在 id：${n.parent}`);
}

// ---------- 2. 补齐稀疏节点 ----------
const enriched = rf.enrichNodes || {};
let enrichCount = 0;
for (const [id, patch] of Object.entries(enriched)) {
  const node = kg.nodes.find((x) => x.id === id);
  if (!node) { fail(`enrichNodes 目标 id 不存在：${id}`); continue; }
  for (const key of Object.keys(patch)) {
    if (key === "id" || key === "name" || key === "category" || key === "level") {
      warn(`enrichNodes[${id}] 试图改写不可变字段 ${key}，已忽略`);
      continue;
    }
    node[key] = patch[key];
  }
  enrichCount++;
}

// enrich 补入的 parent / relatedNodes 也校验
for (const [id, patch] of Object.entries(enriched)) {
  const node = kg.nodes.find((x) => x.id === id);
  if (!node) continue;
  if (node.parent && !allIds.has(node.parent)) fail(`节点 ${id}.parent(补齐) 指向不存在 id：${node.parent}`);
  refOf(node.relatedNodes, `节点 ${id}.relatedNodes(补齐)`);
}

// ---------- 3. 新增边 ----------
const addLinks = rf.addLinks || [];
const linkKey = new Set(kg.links.map((l) => `${l.source}>${l.target}`));
let addLinkCount = 0;
for (const l of addLinks) {
  if (!l || typeof l.source !== "string" || typeof l.target !== "string") {
    fail("存在缺 source/target 的新增边");
    continue;
  }
  if (!allIds.has(l.source)) fail(`边 source 不存在：${l.source}`);
  if (!allIds.has(l.target)) fail(`边 target 不存在：${l.target}`);
  if (l.source === l.target) warn(`自环边：${l.source}>${l.target}`);
  const ls = l.lineStyle || {};
  if (ls.type && !VALID_LINE.has(ls.type)) fail(`边 ${l.source}>${l.target} lineStyle.type 非法：${ls.type}`);
  const key = `${l.source}>${l.target}`;
  if (linkKey.has(key)) { warn(`重复边跳过：${l.source}>${l.target}`); continue; }
  linkKey.add(key);
  // 规整 lineStyle：补 width/color，type 缺省按 label 是否有视为 dashed
  const out = {
    source: l.source,
    target: l.target,
    lineStyle: {
      width: typeof ls.width === "number" ? ls.width : 2,
      type: ls.type || (l.type || (l.label ? "dashed" : "solid")),
    },
  };
  if (ls.color) out.lineStyle.color = ls.color;
  if (typeof ls.opacity === "number") out.lineStyle.opacity = ls.opacity;
  if (l.label) out.label = l.label;
  if (l.type) out.type = l.type;
  kg.links.push(out);
  addLinkCount++;
}

// ---------- 4. 应用节点合并 ----------
kg.nodes.push(...addNodes);

// ---------- 5. 校验合并结果 ----------
const dupId = [];
const seen = new Set();
for (const n of kg.nodes) {
  if (seen.has(n.id)) dupId.push(n.id);
  seen.add(n.id);
}
if (dupId.length) fail(`合并后出现重复节点 id：${dupId.join(", ")}`);

// ---------- 6. 末端校验：所有链接两端存在 ----------
let badLink = 0;
for (const l of kg.links) {
  if (!seen.has(l.source) || !seen.has(l.target)) {
    fail(`最终链接两端存在缺失：${l.source}->${l.target}`);
    badLink++;
  }
}

// ---------- 7. 写回 ----------
if (errors.length) {
  console.error("❌ refine-kg 校验失败，未写回：\n  - " + errors.join("\n  - "));
  process.exit(1);
}

const out = JSON.stringify(kg, null, 2) + "\n";
fs.writeFileSync(KG, out, "utf8");

// ---------- 8. 输出统计 ----------
console.log("✅ refine-kg 完成");
console.log(`   节点：${nodesBefore} → ${kg.nodes.length}（+${addNodes.length}）`);
console.log(`   边：${linksBefore} → ${kg.links.length}（+${addLinkCount}）`);
console.log(`   稀疏节点补齐：${enrichCount}`);
if (warnings.length) {
  console.log("   ⚠ 警告：");
  for (const w of warnings) console.log("      - " + w);
}
