/* ============================================================
   nav-guide.js —— 全站「阶段指示」+ logo 小字（返回主页）
   由各静态页 <script defer> 共享加载。defer 脚本在 DOM 解析后、DOMContentLoaded 前执行，
   因此可直接查询/增改 DOM，与各页内联 IIFE 无时序冲突。
   ============================================================ */
(function(){
"use strict";

/* 模块 → 阶段（按 href 正则命中；首页链接 index.html / main.html 不加 chip） */
var PHMAP=[
  {re:/assistant\.html/,  ph:'mid',  label:'课中'},     /* AI助手（课中随问随答） */
  {re:/knowledge\.html/,  ph:'post', label:'课后'},     /* 知识图谱（课后查漏补缺） */
  {re:/prep\.html/,       ph:'pre',  label:'课前'},     /* 课前预习（对话测评/题库/错题本） */
  {re:/#\/videos/,        ph:'pre',  label:'课前'},     /* 视频资源（课前看操作演示） */
  {re:/#\/report/,        ph:'post', label:'课后'},     /* 报告评估（课后·教师） */
  {re:/generator\.html/,  ph:'pre',  label:'课前'},     /* 智能命题（教师课前组卷） */
  {re:/corpus\.html/,     ph:'post', label:'课后'},     /* 语料库（课后深挖文献） */
  {re:/#\/explore/,       ph:'pre',  label:'课前'}      /* 科普探索（课前兴趣·非化学） */
];
function phOf(href){for(var i=0;i<PHMAP.length;i++)if(PHMAP[i].re.test(href||''))return PHMAP[i];return null;}

/* 1) 导航链接阶段胶囊 */
(function(){
  var links=document.querySelectorAll('.nav-links a');
  for(var i=0;i<links.length;i++){
    var m=phOf(links[i].getAttribute('href'));
    if(!m)continue;
    var s=document.createElement('span');
    s.className='nav-ph';s.setAttribute('data-ph',m.ph);
    s.innerHTML='<i></i>'+m.label;
    links[i].appendChild(s);
  }
})();

/* 2) logo：小字改为「返回主页」（替换化学式副标，缩短导航宽度避免挤占；无则建一个） */
(function(){
  var logo=document.querySelector('.navbar a.logo, #landing a.logo');
  if(!logo)return;
  var sub=logo.querySelector('.logo-sub');
  if(!sub){sub=document.createElement('div');sub.className='logo-sub';logo.appendChild(sub);}
  sub.textContent='返回主页';
  logo.setAttribute('href','main.html');            /* 返回主页统一指向 main.html（全站一致） */
  logo.setAttribute('title','返回主页');
})();

// FIX: [3] - 「🧭 怎么用」按钮已全局移除，删除其 path-btn 事件监听（DOM 已无 .path-btn，此段作废）
})();
