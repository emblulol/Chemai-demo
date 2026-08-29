/* ChemAI · 模型化辅助模块（v69）
   —— 纯运行时辅助，无 IIFE 闭包依赖，可被 node --test 独立测试。
   由 assistant.html 经 ensureAssistantModel() 懒加载，挂 window.AssistantModel。
   职责：打字机状态机、分块工具、思考链/计划/可视化/精通之路仪表盘、SM-2 间隔复习、学习画像导出。
   任何渲染失败都必须回退为「直接插入 HTML」，绝不让答案空白。 */
(function(){
  'use strict';

  function escText(s){ return String(s===null||s===undefined?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

  /* v73：记录按用户命名空间读写（window.ChemAIUser 由 assistant.html 注入）；无则回退旧扁平 key，兼容独立测试 */
  function _lsGet(k, d){
    try{ var U=window.ChemAIUser; if(U&&U.lsGet){ return U.lsGet(String(k).replace(/^chemai_/, ''), d); } }catch(e){}
    try{ var s=localStorage.getItem(k); if(s===null||s===undefined||s==='') return d; try{ return JSON.parse(s); }catch(e){ return d; } }catch(e){ return d; }
  }
  function _lsSet(k, v){
    try{ var U=window.ChemAIUser; if(U&&U.lsSet){ U.lsSet(String(k).replace(/^chemai_/, ''), v); return; } }catch(e){}
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
  }

  /* ---------- 模式 id 列表（与 IIFE 的 MODE_RECIPES 对齐） ---------- */
  var MODE_IDS=['study','deep','quiz','research','visual','mastery'];

  /* ---------- 答案分块：把富文本 HTML 解析成「立即注入 / 逐字打字」的有序块 ---------- */
  var INSTANT_RE=/confidence-bar|selfcheck-warn|skill-card|ans-header|role-intro|role-outro|agent-actions|msds|ref-fold|web-results|ah-badge|\bab-\b|bp-|link-card|calc-|btn|chip/;
  function isInstant(el){
    var tag=el.tagName;
    if(tag==='BUTTON'||tag==='DETAILS'||tag==='UL'||tag==='OL'||tag==='svg'||tag==='TABLE') return true;
    var cls=String(el.className||'');
    if(INSTANT_RE.test(cls)) return true;
    if(el.querySelector('button,details,svg,.confidence-bar,.selfcheck-warn,.skill-card,.ah-badge,.ans-header,.role-intro,.role-outro,.agent-actions')) return true;
    return false;
  }
  function textOf(node){
    var t=(node.textContent||'').replace(/ /g,' ').replace(/\s+/g,' ').trim();
    return t;
  }
  function flatten(node, out, depth){
    if(depth>8){ out.push({kind:'rich', html:node.outerHTML||'', plain:textOf(node), node:node}); return; }
    var kids=node.childNodes;
    if(!kids||!kids.length) return;
    for(var i=0;i<kids.length;i++){
      var c=kids[i];
      if(c.nodeType===3){
        var t=(c.nodeValue||'').replace(/ /g,' ').replace(/\s+/g,' ').trim();
        if(t) out.push({kind:'rich', html:escText(t), plain:t});
        continue;
      }
      if(c.nodeType!==1) continue;
      if(isInstant(c)){ out.push({kind:'instant', html:c.outerHTML}); continue; }
      if(c.querySelector('button,details,svg,.confidence-bar,.selfcheck-warn,.skill-card,.ah-badge,.ans-header,.role-intro,.role-outro,.agent-actions')){
        flatten(c, out, depth+1);
      }else{
        out.push({kind:'rich', html:c.outerHTML, plain:textOf(c)});
      }
    }
  }
  function buildStagedBlocks(html){
    if(!html) return [];
    var tmp=document.createElement('div');
    tmp.innerHTML=html;
    var out=[];
    var kids=Array.prototype.slice.call(tmp.childNodes);
    for(var i=0;i<kids.length;i++){
      var c=kids[i];
      if(c.nodeType===3){
        var t=(c.nodeValue||'').replace(/ /g,' ').replace(/\s+/g,' ').trim();
        if(t) out.push({kind:'rich', html:escText(t), plain:t});
        continue;
      }
      if(c.nodeType!==1) continue;
      if(isInstant(c)){ out.push({kind:'instant', html:c.outerHTML}); continue; }
      if(c.querySelector('button,details,svg,.confidence-bar,.selfcheck-warn,.skill-card,.ah-badge,.ans-header,.role-intro,.role-outro,.agent-actions')){ flatten(c, out, 0); }
      else{ out.push({kind:'rich', html:c.outerHTML, plain:textOf(c)}); }
    }
    return out.filter(function(b){ return b.plain || b.kind==='instant'; });
  }

  /* ---------- 打字机状态机 ---------- */
  function renderNode(html){
    var tmp=document.createElement('div'); tmp.innerHTML=html;
    return tmp.firstChild;
  }
  var Typewriter={
    write:function(opts){
      var target=opts.target, blocks=opts.blocks||[], cps=opts.cps||40, blockDelay=(opts.blockDelay===undefined?50:opts.blockDelay);
      var onTick=opts.onTick||function(){}, onDone=opts.onDone||function(){}, signal=opts.signal||{cancelled:false};
      var i=0, perChar=Math.max(1, Math.round(1000/cps));
      function finish(cancelled){ onDone(!!cancelled); }
      function next(){
        if(signal.cancelled){ // 取消：剩余全部立即注入，保答案完整
          while(i<blocks.length){ var cb=blocks[i++]; target.insertAdjacentHTML('beforeend', cb.kind==='instant'?cb.html:cb.html); }
          finish(true); return;
        }
        if(i>=blocks.length){ finish(false); return; }
        var b=blocks[i++];
        if(b.kind==='instant'){ target.insertAdjacentHTML('beforeend', b.html); onTick(); setTimeout(next, blockDelay); return; }
        var ghost=document.createElement('span'); ghost.className='tw-ghost';
        target.appendChild(ghost);
        var txt=document.createTextNode(''); ghost.appendChild(txt);
        var chars=(b.plain||'').split(''); var ci=0;
        function typeChar(){
          if(signal.cancelled){ ghost.replaceWith(renderNode(b.html)); onTick(); next(); return; }
          if(ci<chars.length){ txt.nodeValue+=chars[ci++]; if(ci%3===0) onTick(); setTimeout(typeChar, perChar); }
          else{ try{ ghost.replaceWith(renderNode(b.html)); }catch(e){ ghost.remove(); } onTick(); setTimeout(next, blockDelay); }
        }
        typeChar();
      }
      next();
    }
  };

  /* ---------- 思考链面板 ---------- */
  function buildReasoningHTML(trace){
    var c=trace.counts||{}; var metaParts=[];
    if(c.hits) metaParts.push(c.hits+' 条检索'); else metaParts.push('检索未命中');
    if(c.analogy) metaParts.push(c.analogy+' 条类比');
    if(trace.label) metaParts.push(trace.label);
    var meta=metaParts.join(' · ');
    return '<details class="reasoning"'+(trace.open===false?'':' open')+'><summary>🧠 思考链<em class="rc-cnt">'+escText(meta)+'</em></summary>'
      +'<div class="reasoning-body" style="display:flex;flex-direction:column;gap:10px">'+(trace.bodyHTML||'')+'</div></details>';
  }

  /* ---------- 多步计划面板（plan mode / 深度求解 / 深度研究） ---------- */
  function buildPlanHTML(q, kws){
    var steps=[
      ['理解目标','拆解提问，明确要解决的核心化学问题'],
      ['关键词检索','定位语料库 / FAQ / 知识图谱命中'],
      ['跨体系类比','寻找相似配合物、方法与反应机理'],
      ['推理验证','按配位化学自洽规则推演结论'],
      ['结论输出','给出依据与置信度，标注来源']
    ];
    var kwsHtml=(kws&&kws.length)?(' · 关键词：'+kws.slice(0,6).map(function(k){return '<code>'+escText(k)+'</code>';}).join(' ')):'';
    return '<div class="plan" data-role="plan"><div class="plan-title">🧭 执行计划</div>'
      +'<div class="plan-q">'+escText(q)+kwsHtml+'</div>'
      +steps.map(function(s,i){ return '<div class="plan-step" data-s="'+(i+1)+'"><span class="plan-n">'+(i+1)+'</span><div class="plan-st"><b>'+escText(s[0])+'</b><span>'+escText(s[1])+'</span></div></div>'; }).join('')
      +'</div>';
  }

  /* ---------- 可视化（出 SVG 流程图，mermaid 不在本仓库） ---------- */
  function buildVisualHTML(q, kgNodes){
    var hasFlow=/流程|步骤|反应|机理|图/.test(q||'');
    if(hasFlow){
      var labels=['原料 · 草酸亚铁','氧化络合 · K₃[Fe(C₂O₄)₃]','析晶 · 避光干燥'];
      if(/沉淀/.test(q||'')) labels=['沉淀反应','氧化反应','配位反应'];
      var bw=250,bh=58,gap=48,y0=14,x0=18;
      var rows=[];
      for(var i=0;i<3;i++){ rows.push(buildFlowBox(x0,y0+i*(bh+gap),bw,bh,i+1,labels[i],i<2,gap)); }
      return '<div class="ans-sec"><div class="rich-answer"><div class="visual"><div style="font-size:13px;color:var(--t2)">🖼 '+escText(q||'流程图')+'</div>'
        +'<svg width="'+(bw+40)+'" height="'+(bh*3+gap*2+20)+'" viewBox="0 0 '+(bw+40)+' '+(bh*3+gap*2+20)+'" role="img">'+rows.join('')+'</svg></div></div></div>';
    }
    if(kgNodes&&kgNodes.length){
      var items=kgNodes.slice(0,8).map(function(n){ return '<span class="ah-badge src-corpus">'+escText(n.name||n.id||'')+'</span>'; }).join(' ');
      return '<div class="ans-sec"><div class="rich-answer"><div class="visual"><div style="font-size:13px;color:var(--t2)">📊 知识图谱关联</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">'+items+'</div></div></div></div>';
    }
    return '<div class="ans-sec"><div class="rich-answer"><div class="visual"><div style="font-size:13px;color:var(--t2)">🔎 想可视化？试试「画出三步反应的流程图」「生成抽滤装置示意图」这类提问。</div></div></div></div>';
  }
  function buildFlowBox(x,y,w,h,n,label,arrow,gap){
    var grad='#1a2235';
    var s='<g><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" fill="'+grad+'" stroke="rgba(45,212,191,.35)" stroke-width="1.5"/>'
      +'<circle cx="'+(x+22)+'" cy="'+(y+h/2)+'" r="13" fill="rgba(45,212,191,.2)" stroke="rgba(45,212,191,.5)"/>'
      +'<text x="'+(x+22)+'" y="'+(y+h/2+5)+'" font-size="13" fill="#2dd4bf" text-anchor="middle">'+n+'</text>'
      +'<text x="'+(x+44)+'" y="'+(y+h/2+5)+'" font-size="13" fill="#f1f5f9">'+escText(label)+'</text>'
      +'</g>';
    if(arrow){ s+='<line x1="'+(x+w/2)+'" y1="'+(y+h)+'" x2="'+(x+w/2)+'" y2="'+(y+h+gap)+'" stroke="rgba(96,165,250,.5)" stroke-width="2" stroke-dasharray="4 4"/>'
      +'<path d="M '+(x+w/2-5)+' '+(y+h+gap-6)+' L '+(x+w/2)+' '+(y+h+gap)+' L '+(x+w/2+5)+' '+(y+h+gap-6)+'" fill="none" stroke="rgba(96,165,250,.6)" stroke-width="2"/>'; }
    return s;
  }

  /* ---------- 精通之路：间隔复习仪表盘（读 localStorage） ---------- */
  function srsSchedule(mastery, reps, prevInterval){
    var interval=Math.max(1, (prevInterval||1));
    if(reps===0) interval=1; else if(reps===1) interval=3; else interval=Math.min(60, Math.round(interval*2));
    var ef=2.5;
    if(mastery>=0.85) ef=2.6; else if(mastery>=0.6) ef=2.1; else if(mastery>=0.5) ef=1.9; else ef=1.6;
    return {interval:interval, ef:Math.round(ef*100)/100, dueInDays:Math.max(1,interval)};
  }
  function srsDueToday(){
    var srs=_lsGet('chemai_srs_v1', {cards:[]});
    var today=new Date(); today.setHours(0,0,0,0);
    return (srs.cards||[]).filter(function(c){ var d=new Date(c.due||0); d.setHours(0,0,0,0); return d.getTime()<=today.getTime(); });
  }
  /* Phase2 纯函数：把本次测评的 items 合并进既有 SRS 卡（首卡 due=now 立即可复习；复习卡 reps++/外推间隔）。now 注入以便单测。 */
  var DAY_MS=86400000;
  function srsMerge(existingCards, items, now){
    var cards=[], map={}, t=(now||Date.now());
    (existingCards||[]).forEach(function(c){ if(c&&c.name) map[c.name]=c; });
    (items||[]).forEach(function(it){
      if(!it||!it.name||it.m===null||it.m===undefined) return;
      var ex=map[it.name], reps, interval, ef, due;
      if(ex){
        reps=(ex.reps||0)+1;
        var sc=srsSchedule(it.m, reps, ex.interval||1);
        interval=sc.interval; ef=sc.ef; due=t+sc.interval*DAY_MS;
      }else{
        reps=0;
        var sc0=srsSchedule(it.m, 0, 1);
        interval=sc0.interval; ef=sc0.ef; due=t;
      }
      cards.push({name:it.name, mastery:Math.round(it.m*100)/100, reps:reps, interval:interval, ef:ef, due:due});
      map[it.name]=null;
    });
    Object.keys(map).forEach(function(k){ var c=map[k]; if(c) cards.push(c); });
    return cards;
  }
  /* Phase2 纯函数：反馈净重（👍 +1.5 / 👎 -1.5，clamp ±3，保留 1 位小数）。 */
  function feedbackDelta(prev, vote){
    var base=(prev||0)+((vote==='up')?1.5:-1.5);
    return Math.round(Math.max(-3, Math.min(3, base))*10)/10;
  }
  function buildMasteryDashboardHTML(){
    var m=_lsGet('chemai_mastery_v1', null);
    var due=srsDueToday();
    var head='';
    if(m&&m.items&&m.items.length){
      head='<div class="ans-sec"><div class="rich-answer"><div class="mastery-head"><div class="mh-grade '+((m.total>=80)?'high':(m.total>=60)?'mid':'low')+'">'+Math.round(m.total||0)+'<span>/100</span></div>'
        +'<div><b>最近掌握度测评</b><div style="font-size:12px;color:var(--t3)">'+escText(m.date||'')+' · '+(m.items.filter(function(x){return x.m!==null;}).length)+'/10 知识点已测</div></div></div>'
        +'<div class="kp-bar" style="margin-top:10px"><i style="width:'+Math.min(100,Math.round(m.total||0))+'%;background:var(--em)"></i></div>'
        +'</div></div>';
    }else{
      head='<div class="ans-sec"><div class="rich-answer"><p>还没有掌握度测评记录。先做一次 <b>📝 掌握度测评</b>，我就能为你生成个性化复习路线。</p></div></div>';
    }
    var review='';
    if(due.length){
      var cards=due.slice(0,6).map(function(c,idx){ return '<div class="srs-card"><div class="sc-name">'+escText(c.name||('知识点 '+(idx+1)))+'</div><div class="sc-meta">已复习 '+escText(c.reps||0)+' 次 · 上次掌握度 '+Math.round((c.mastery||0)*100)+'%</div><button class="btn ghost sm" onclick="goAssess()">↻ 现在复习</button></div>'; }).join('');
      review='<div class="ans-sec"><div class="rich-answer"><div style="font-size:13px;color:var(--em)">⏰ '+(due.length)+' 张复习卡到期</div><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">'+cards+'</div></div></div>';
    }else{
      review='<div class="ans-sec"><div class="rich-answer"><div style="font-size:13px;color:var(--t2)">✅ 暂无到期复习卡。继续保持节奏，或<button class="btn ghost sm" onclick="goAssess()">开始新测评</button></div></div></div>';
    }
    var exportBtn='<div class="ans-sec"><div class="rich-answer"><div style="font-size:13px;color:var(--t2)">📤 学习画像导出：把掌握度、错题、反馈、SRS 复习计划打包为 JSON，供离线训练回流。</div><button class="btn ghost sm" style="margin-top:8px" onclick="exportLearningJSON()">📤 导出学习画像</button></div></div>';
    var favSection='<div id="favSection">'+buildFavoritesHTML()+'</div>';
    return head+review+exportBtn+favSection;
  }

  /* ---------- 学习画像导出（IIFE 负责传数据，本函数纯聚合） ---------- */
  function exportLearningJSON(data){
    var out=data||{};
    var payload={
      exportedAt:new Date().toISOString(),
      user:out.user||null,
      mastery:out.mastery||null,
      wrong:out.wrong||[],
      feedback:out.feedback||[],
      srs:out.srs||null,
      favorites:out.favorites||[],
      notes:out.notes||{}
    };
    return JSON.stringify(payload, null, 2);
  }

  /* ---------- 收藏 + 笔记（闻道③），纯 localStorage，多页复用 ---------- */
  function getFavorites(){ return _lsGet('chemai_favorites_v1', []); }
  function isFavorite(id){ var f=getFavorites(); for(var i=0;i<f.length;i++){ if(String(f[i].id)===String(id)) return true; } return false; }
  function toggleFavorite(item){
    if(!item||item.id===undefined||item.id===null) return false;
    var f=getFavorites(), idx=-1;
    for(var i=0;i<f.length;i++){ if(String(f[i].id)===String(item.id)){ idx=i; break; } }
    if(idx>=0){ f.splice(idx,1); _lsSet('chemai_favorites_v1', f); return false; }
    f.push({id:item.id, title:item.title||'', src:item.src||'', subfield:item.subfield||''});
    _lsSet('chemai_favorites_v1', f); return true;
  }
  function getNote(id){ var n=_lsGet('chemai_notes_v1', {}); return (id===undefined||id===null)?'':(n[String(id)]||''); }
  function saveNote(id, text){ var n=_lsGet('chemai_notes_v1', {}); if(id===undefined||id===null) return; var k=String(id); if(!text||!String(text).trim()){ delete n[k]; } else { n[k]=String(text); } _lsSet('chemai_notes_v1', n); }
  function buildFavoritesHTML(){
    var f=getFavorites(), n=_lsGet('chemai_notes_v1', {});
    var head='<div class="ans-sec"><div class="rich-answer"><div style="font-size:13px;color:var(--em)">📍 我的收藏与笔记（'+f.length+' 项，并入学习画像导出）</div>';
    if(!f.length){ return head+'<div style="font-size:12.5px;color:var(--t3);margin-top:6px">还没有收藏。在语料库 / 知识图谱点「📌 收藏」即可加入。</div></div></div>'; }
    var cards=f.map(function(it){
      var k=String(it.id), note=n[k]||'';
      var srcLabel=it.src==='kg'?'知识图谱':it.src==='corpus'?'语料库':(it.src||'');
      return '<div class="srs-card" style="flex-direction:column;align-items:stretch">'
        +'<div class="sc-name">'+escText(it.title||it.id)+' <span class="ah-badge src-faq" style="margin-left:4px">'+escText(srcLabel)+'</span></div>'
        +'<textarea data-note="'+escText(k)+'" placeholder="写点笔记…" rows="2" style="margin:6px 0 4px;width:100%;min-height:38px;background:var(--bg2);color:var(--t1);border:1px solid var(--bd2);border-radius:8px;padding:6px 8px;font:inherit">'+escText(note)+'</textarea>'
        +'<div style="display:flex;gap:6px"><button class="btn ghost sm" onclick="favAct(\''+escText(k)+'\',\'save\')">💾 保存笔记</button>'
        +'<button class="btn ghost sm" onclick="favAct(\''+escText(k)+'\',\'remove\')">🗑 移除收藏</button></div>'
        +'</div>';
    }).join('');
    return head+'<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">'+cards+'</div></div></div>';
  }

  /* ---------- 多文献横向对比表（闻道①），讲义为最高权威 ---------- */
  function buildCompareTableHTML(rows){
    if(!rows||!rows.length) return '';
    var cols=rows[0].cells||[];
    var th='<tr><th>参数</th><th style="min-width:110px">📖 讲义权威值</th>';
    cols.forEach(function(c){ th+='<th>'+escText(c.title)+'</th>'; });
    th+='</tr>';
    var tb=rows.map(function(r){
      return '<tr><td>'+escText(r.param)+'</td><td style="color:#2dd4bf">'+escText(r.lecture+'')+'</td>'
        +(r.cells||[]).map(function(c){ return '<td>'+(c.hit?'<span class="cmp-bad" title="与讲义不符">⚠</span>':'<span class="muted">—</span>')+'</td>'; }).join('')
        +'</tr>';
    }).join('');
    return '<div class="link-card web web-results cmp"><div style="font-size:16px;font-weight:700;color:var(--t1)">📊 多文献横向对比</div>'
      +'<div style="font-size:12px;color:var(--t3);margin:4px 0 8px">以武汉大学实验讲义为最高权威，核对各来源中易生歧义的参数。⚠ = 某来源所述与讲义不符。</div>'
      +'<div class="table-wrap" style="overflow-x:auto"><table style="min-width:420px;width:100%">'+th+tb+'</table></div></div>';
  }

  window.AssistantModel={
    MODE_IDS:MODE_IDS,
    buildStagedBlocks:buildStagedBlocks,
    Typewriter:Typewriter,
    buildReasoningHTML:buildReasoningHTML,
    buildPlanHTML:buildPlanHTML,
    buildVisualHTML:buildVisualHTML,
    buildMasteryDashboardHTML:buildMasteryDashboardHTML,
    srsSchedule:srsSchedule,
    srsDueToday:srsDueToday,
    srsMerge:srsMerge,
    feedbackDelta:feedbackDelta,
    exportLearningJSON:exportLearningJSON,
    getFavorites:getFavorites,
    isFavorite:isFavorite,
    toggleFavorite:toggleFavorite,
    saveNote:saveNote,
    getNote:getNote,
    buildFavoritesHTML:buildFavoritesHTML,
    buildCompareTableHTML:buildCompareTableHTML
  };
})();
