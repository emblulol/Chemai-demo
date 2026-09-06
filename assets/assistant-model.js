/* ChemAI · 模型化辅助模块（v69）
   —— 纯运行时辅助，无 IIFE 闭包依赖，可被 node --test 独立测试。
   由 assistant.html 经 ensureAssistantModel() 懒加载，挂 window.AssistantModel。
   职责：打字机状态机、分块工具、思考链/计划/可视化/精通之路仪表盘、SM-2 间隔复习、学习画像导出。
   任何渲染失败都必须回退为「直接插入 HTML」，绝不让答案空白。 */
(function(){
  'use strict';

  function escText(s){ return String(s===null||s===undefined?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

  function _lsGet(k, d){ try{ var s=localStorage.getItem(k); if(s===null||s===undefined||s==='') return d; try{ return JSON.parse(s); }catch(e){ return d; } }catch(e){ return d; } }
  function _lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

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
        /* 长段直接注入：避免打字机把整段富文本压成"去空白长串"导致不知所云；短块保留逐字动画 */
        if(b.kind==='rich' && (b.plain||'').length>60){ target.insertAdjacentHTML('beforeend', b.html); onTick(); setTimeout(next, blockDelay); return; }
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
    return '<details class="reasoning"'+(trace.open===false?'':' open')+'><summary>思考链<em class="rc-cnt">'+escText(meta)+'</em></summary>'
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
    return '<div class="plan" data-role="plan"><div class="plan-title">执行计划</div>'
      +'<div class="plan-q">'+escText(q)+kwsHtml+'</div>'
      +steps.map(function(s,i){ return '<div class="plan-step" data-s="'+(i+1)+'"><span class="plan-n">'+(i+1)+'</span><div class="plan-st"><b>'+escText(s[0])+'</b><span>'+escText(s[1])+'</span></div></div>'; }).join('')
      +'</div>';
  }

  /* ---------- 可视化（富模板：SVG 示意，mermaid 不在本仓库） ---------- */
  function vizWrap(inner, title){
    return '<div class="ans-sec"><div class="rich-answer"><div class="visual">'
      +'<div style="font-size:13px;color:var(--t2,#94a3b8)">'+(title||'可视')+'</div>'+inner
      +'</div></div></div>';
  }
  function vizsvg(w,h,body){
    return '<svg viewBox="0 0 '+w+' '+h+'" role="img" style="width:100%;max-width:680px;height:auto;display:block;margin:0 auto">'+body+'</svg>';
  }
  /* 类型分派：从特异到通用 */
  function detectVizType(q){
    var s=String(q||'');
    if(/异构|手性|对映|旋光|外消旋|镜像|Δ\s*\[|Λ\s*\[/i.test(s)) return 'isomer';
    if(/晶体场|能级分裂|d\s*5|d⁵|t2g|t₂g|CFSE|d轨道|场分裂/i.test(s)) return 'crystal';
    if(/配合物|螯合|配位(结构|构型|键|环)|空间构型|立体结构|\[Fe\s*\(|C2O4\)3|八面体(配合|结构|构型)/i.test(s)) return 'complex';
    if(/抽滤|布氏漏斗|真空泵|水流泵|抽滤瓶|过滤装置|装置|仪器/i.test(s)) return 'apparatus';
    if(/tg|dsc|热重|热分析|差热|失重曲线|分解温度|热量量|tga/i.test(s)) return 'thermal';
    if(/滴定|突跃|计量点|高锰酸钾|kmno4|标定|草酸根含量|含量测定|自指示/i.test(s)) return 'titration';
    if(/氧化还原|电极(电势|电位)|电位|电势|半反应|latimer|e°|电对/i.test(s)) return 'redox';
    if(/安全|防护|危化|通风|手套|护目镜|急救|误食|溅|戴手套|注意/i.test(s)) return 'safety';
    if(/知识图谱|图谱|关联图|节点图|关系图|关系网/i.test(s)) return 'kg';
    if(/流程|步骤|反应|机理|制备|合成|生产|怎么做|怎么制|怎么合成/i.test(s)) return 'flow';
    return null;
  }
  /* 主入口：按类型派发到富构建器；任何失败宁可回退也不留空白 */
  function buildVisualHTML(q, kg){
    var t=detectVizType(q);
    try{
      if(t==='isomer') return buildIsomerViz(q);
      if(t==='crystal') return buildCrystalFieldViz(q);
      if(t==='complex') return buildComplexViz(q);
      if(t==='apparatus') return buildApparatusViz(q);
      if(t==='thermal') return buildThermalViz(q);
      if(t==='titration') return buildTitrationViz(q);
      if(t==='redox') return buildRedoxViz(q);
      if(t==='safety') return buildSafetyViz(q);
      if(t==='kg') return buildKnowGraphViz(q, kg);
      if(t==='flow') return buildFlowViz(q);
    }catch(e){}
    return vizWrap('<div style="font-size:13px;color:var(--t3,#64748b)">想可视化？试试「画出三步反应的流程图」「生成抽滤装置示意图」「画 d⁵ 八面体场能级分裂图」「画配合物的立体结构」「画 Δ/Λ 手性异构体」「画出高锰酸钾滴定草酸根曲线」「画出氧化还原电位图」「用知识图谱展示配位组成」「本实验安全要点」。</div>','🖼 可视化');
  }

  /* ---- 流程（默认/制备类）：紧凑蛇形（3上+2下），数值锚定讲义 ---- */
  function buildFlowViz(q){
    var steps;
    if(/沉淀/.test(q||'')){
      steps=[['沉淀反应','草酸 + 草酸亚铁 → FeC₂O₄↓（黄色）','沉淀'],['氧化反应','40℃ 水浴逐滴加 H₂O₂(8mL)','氧化'],['配位反应','与草酸根配位 → [Fe(C₂O₄)₃]³⁻','配位']];
    }else{
      steps=[['原料溶解','0.5mol/L 草酸 + 草酸亚铁，温热搅拌','溶解'],['氧化络合','40℃ 水浴逐滴加 H₂O₂(8mL)，过量煮沸除去','氧化'],['析晶','加乙醇降低溶解度，冰水冷却结晶','结晶'],['抽滤','布氏漏斗减压抽滤，少量多次乙醇洗涤','过滤'],['干燥','100℃ 失水，翠绿晶体，避光保存','干燥']];
    }
    var bw=150,bh=62,rowY=48,rowGap=70,x0=24,xgap=40;
    function box(x,y,i,hl){ return buildFlowBoxEx(x,y,bw,bh,i+1,steps[i][0],steps[i][1],steps[i][2],false,0,hl); }
    function hArrow(x1,x2,y){ return '<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" stroke="rgba(96,165,250,.5)" stroke-width="2" stroke-dasharray="4 4"/><path d="M '+x2+' '+y+' L '+(x2-6)+' '+(y-5)+' L '+(x2-6)+' '+(y+5)+' Z" fill="rgba(96,165,250,.6)"/>'; }
    function vArrow(x,y1,y2){ return '<line x1="'+x+'" y1="'+y1+'" x2="'+x+'" y2="'+y2+'" stroke="rgba(96,165,250,.5)" stroke-width="2" stroke-dasharray="4 4"/><path d="M '+x+' '+y2+' L '+(x-5)+' '+(y2-6)+' L '+(x+5)+' '+(y2-6)+' Z" fill="rgba(96,165,250,.6)"/>'; }
    var d='',W,H,rightX=x0+2*(bw+xgap);
    if(steps.length<=3){
      for(var a=0;a<steps.length;a++){ var xa=x0+a*(bw+xgap); d+=box(xa,rowY,a, a===1); if(a<steps.length-1) d+=hArrow(xa+bw, xa+bw+xgap, rowY+bh/2); }
      W=rightX+bw+x0;
      H=rowY+bh+84;
    }else{
      var y2=rowY+bh+rowGap;
      for(var i=0;i<3;i++){ var xi=x0+i*(bw+xgap); d+=box(xi,rowY,i, i===1); if(i<2) d+=hArrow(xi+bw, xi+bw+xgap, rowY+bh/2); }
      d+=vArrow(rightX+bw/2, rowY+bh, y2);
      d+=box(rightX, y2, 3, false);
      d+=hArrow(rightX, x0+bw+xgap, y2+bh/2);
      d+=box(x0+bw+xgap, y2, 4, false);
      W=rightX+bw+x0;
      H=y2+bh+84;
    }
    d='<text x="'+x0+'" y="24" font-size="13.5" style="fill:var(--t1,#f1f5f9)" font-weight="600">反应流程（'+steps.length+' 步）</text>'+d
      +'<text x="'+x0+'" y="'+(H-30)+'" font-size="11" style="fill:var(--t2,#94a3b8)">备注：① 先沉淀 FeC₂O₄ 除杂 → ② 氧化调至 +3 价 → ③ 配位成产物；产物 K₃[Fe(C₂O₄)₃]·3H₂O 翠绿色。</text>'
      +'<text x="'+x0+'" y="'+(H-12)+'" font-size="11" style="fill:var(--t3,#64748b)">含 3 分子结晶水（约 11%，见 TG-DSC）；见光易分解，应避光保存。</text>';
    return vizWrap(vizsvg(W,H,d),'🖼 '+(escText(q||'反应流程')));
  }
  function buildFlowBoxEx(x,y,w,h,n,title,desc,tag,arrow,gap,hl){
    var grad=hl?'var(--em,#10b981)':'var(--card,#1a2235)';
    var stroke=hl?'rgba(16,185,129,.9)':'rgba(45,212,191,.35)';
    var s='<g>';
    if(tag&&tag!==title){ s+='<rect x="'+(x+w-74)+'" y="'+(y-11)+'" width="64" height="18" rx="9" fill="rgba(16,185,129,.16)"/>'
      +'<text x="'+(x+w-42)+'" y="'+(y+2)+'" font-size="10.5" style="fill:var(--em,#10b981)" text-anchor="middle">'+escText(tag)+'</text>'; }
    s+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" style="fill:'+grad+';stroke:'+stroke+';stroke-width:1.5"/>'
      +'<circle cx="'+(x+26)+'" cy="'+(y+26)+'" r="14" style="fill:rgba(45,212,191,.2);stroke:rgba(45,212,191,.5)"/>'
      +'<text x="'+(x+26)+'" y="'+(y+31)+'" font-size="13.5" style="fill:#2dd4bf" text-anchor="middle">'+n+'</text>'
      +'<text x="'+(x+50)+'" y="'+(y+24)+'" font-size="13" font-weight="600" style="fill:var(--t1,#f1f5f9)">'+escText(title)+'</text>'
      +'<text x="'+(x+50)+'" y="'+(y+47)+'" font-size="11" style="fill:var(--t2,#94a3b8)">'+escText(desc)+'</text>'
      +'</g>';
    if(arrow){ s+='<line x1="'+(x+w/2)+'" y1="'+(y+h+4)+'" x2="'+(x+w/2)+'" y2="'+(y+h+gap-2)+'" stroke="rgba(96,165,250,.5)" stroke-width="2" stroke-dasharray="4 4"/>'
      +'<path d="M '+(x+w/2-5)+' '+(y+h+gap-8)+' L '+(x+w/2)+' '+(y+h+gap-2)+' L '+(x+w/2+5)+' '+(y+h+gap-8)+'" fill="none" stroke="rgba(96,165,250,.6)" stroke-width="2"/>'; }
    return s;
  }

  /* ---- 八面体晶体场能级分裂（Fe³⁺ 3d⁵ 高自旋） ---- */
  function orbitalLine(x1,x2,y){ return '<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" stroke="rgba(45,212,191,.55)" stroke-width="2" stroke-linecap="round"/>'; }
  function electronUp(x,y){ return '<text x="'+x+'" y="'+(y+5)+'" font-size="14" style="fill:var(--em,#10b981)" text-anchor="middle">↑</text>'; }
  function buildCrystalFieldViz(q){
    var d='',W=620,H=300;
    /* 左：自由离子 3d⁵ 简并 */
    d+='<text x="120" y="56" font-size="13" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">自由离子 Fe³⁺（3d⁵）</text>';
    d+='<line x1="48" y1="140" x2="196" y2="140" stroke="rgba(148,163,184,.7)" stroke-width="3" stroke-linecap="round"/>';
    for(var i=0;i<5;i++){ var tx=60+i*30; d+='<line x1="'+tx+'" y1="134" x2="'+tx+'" y2="146" stroke="rgba(148,163,184,.5)" stroke-width="2"/>'; }
    d+='<text x="120" y="166" font-size="12" style="fill:var(--t3,#64748b)" text-anchor="middle">5 × d 轨道（能量简并）</text>';
    /* 中：引入八面体场 */
    d+='<line x1="206" y1="140" x2="300" y2="140" stroke="rgba(96,165,250,.7)" stroke-width="2"/>'
      +'<path d="M 300 140 L 290 134 L 290 146 Z" fill="rgba(96,165,250,.8)"/>'
      +'<text x="252" y="126" font-size="12" style="fill:var(--blue,#60a5fa)" text-anchor="middle">加入八面体场</text>';
    /* 右：eg（上2）+ t₂g（下3） */
    d+='<text x="430" y="56" font-size="13" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">八面体场（草酸 / H₂O 弱场）</text>';
    var egY=[94,118], tgY=[150,174,198];
    for(var j=0;j<egY.length;j++){ d+=orbitalLine(352,478,egY[j]); }
    for(var k=0;k<tgY.length;k++){ d+=orbitalLine(352,478,tgY[k]); }
    d+='<text x="488" y="96" font-size="12.5" style="fill:var(--teal,#2dd4bf)">eg</text>'
      +'<text x="488" y="182" font-size="12.5" style="fill:var(--teal,#2dd4bf)">t₂g</text>';
    d+='<text x="488" y="118" font-size="10" style="fill:var(--t3,#64748b)">d_{x²−y²} / d_{z²}</text>'
      +'<text x="488" y="204" font-size="10" style="fill:var(--t3,#64748b)">d_{xy} / d_{yz} / d_{xz}</text>';
    /* Δo 双向箭头 */
    d+='<line x1="330" y1="122" x2="330" y2="148" stroke="var(--yellow,#fbbf24)" stroke-width="2"/>'
      +'<path d="M 330 122 L 325 132 L 335 132 Z" fill="var(--yellow,#fbbf24)"/>'
      +'<path d="M 330 148 L 325 138 L 335 138 Z" fill="var(--yellow,#fbbf24)"/>'
      +'<text x="322" y="137" font-size="13" style="fill:var(--yellow,#fbbf24)" text-anchor="end">Δo = 10Dq</text>';
    /* 高自旋排布：t₂g³ eg²（5 单电子） */
    electronUp(404,94); electronUp(404,118); electronUp(404,150); electronUp(404,174); electronUp(404,198);
    d+='<text x="120" y="216" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">Δo（弱场）&lt; P（成对能）→ 高自旋</text>'
      +'<text x="120" y="234" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">排布 t₂g³ eg² · 未成对电子 = 5 · 无配位场稳定化能 CFSE = 0</text>';
    d+='<text x="120" y="252" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">磁性：μ = √(5·7) ≈ 5.92 BM（顺磁）· 因为 Δo 小、电子难以成对</text>';
    /* 光谱化学序列注记 */
    d+='<rect x="308" y="242" width="298" height="44" rx="8" style="fill:var(--card,#1a2235);stroke:rgba(167,139,250,.35);stroke-width:1"/>'
      +'<text x="318" y="258" font-size="11" style="fill:var(--purple,#a78bfa)">光谱化学序列（弱 → 强）：H₂O ≤ C₂O₄²⁻ &lt; NH₃ &lt; en &lt; CN⁻</text>'
      +'<text x="318" y="275" font-size="10.5" style="fill:var(--t3,#64748b)">草酸/水处弱场端 → Δo 小于成对能 P → 低自旋轨道分裂但电子不配对 → 高自旋 d⁵</text>';
    return vizWrap(vizsvg(W,H,d),'🖼 '+(escText(q||'晶体场能级分裂')));
  }

  /* ---- 抽滤装置示意 ---- */
  function buildApparatusViz(q){
    var d='',W=520,H=360;
    /* 台面 */
    d+='<line x1="16" y1="286" x2="504" y2="286" stroke="rgba(148,163,184,.45)" stroke-width="3"/>';
    /* 铁架台（竖杆 + 铁圈夹持漏斗，标注清晰） */
    d+='<line x1="60" y1="286" x2="60" y2="46" stroke="rgba(148,163,184,.75)" stroke-width="6"/>'
      +'<line x1="60" y1="52" x2="150" y2="52" stroke="rgba(148,163,184,.7)" stroke-width="5"/>'
      +'<circle cx="60" cy="286" r="13" fill="rgba(148,163,184,.2)" stroke="rgba(148,163,184,.7)" stroke-width="2"/>';
    d+='<text x="60" y="308" font-size="11" style="fill:var(--t2,#94a3b8)" text-anchor="middle">铁架台</text>';
    /* 布氏漏斗 + 滤纸 */
    d+='<path d="M 104 46 L 220 46 L 204 104 L 120 104 Z" fill="rgba(96,165,250,.12)" stroke="rgba(96,165,250,.7)" stroke-width="2"/>';
    d+='<line x1="120" y1="104" x2="204" y2="104" stroke="rgba(45,212,191,.7)" stroke-width="2"/>';
    d+='<path d="M 128 104 L 196 104 L 184 162 L 140 162 Z" fill="rgba(96,165,250,.08)" stroke="rgba(96,165,250,.7)" stroke-width="2"/>';
    d+='<text x="162" y="36" font-size="12" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">布氏漏斗</text>';
    d+='<text x="150" y="118" font-size="10.5" style="fill:var(--teal,#2dd4bf)" text-anchor="middle">滤纸</text>';
    /* 抽滤瓶 */
    d+='<path d="M 162 162 L 96 262 L 228 262 Z" fill="rgba(45,212,191,.1)" stroke="rgba(45,212,191,.65)" stroke-width="2"/>';
    d+='<rect x="216" y="200" width="48" height="18" rx="4" fill="rgba(45,212,191,.1)" stroke="rgba(45,212,191,.65)" stroke-width="2"/>';
    d+='<text x="162" y="282" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">抽滤瓶（滤液承接）</text>';
    /* 胶管 */
    d+='<path d="M 264 209 q 12 -9 24 0 q 12 9 24 0 q 12 -9 24 0" fill="none" stroke="rgba(167,139,250,.75)" stroke-width="3"/>';
    d+='<text x="304" y="192" font-size="11.5" style="fill:var(--purple,#a78bfa)" text-anchor="middle">胶管</text>';
    /* 真空泵 */
    d+='<rect x="360" y="180" width="96" height="70" rx="10" fill="rgba(167,139,250,.12)" stroke="rgba(167,139,250,.7)" stroke-width="2"/>';
    d+='<circle cx="408" cy="212" r="12" fill="rgba(167,139,250,.25)" stroke="rgba(167,139,250,.8)" stroke-width="2"/>';
    d+='<text x="408" y="168" font-size="11.5" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">真空泵/水流泵</text>';
    /* 抽真空方向 */
    d+='<line x1="340" y1="209" x2="360" y2="209" stroke="rgba(244,113,113,.8)" stroke-width="2" stroke-dasharray="5 4"/>'
      +'<path d="M 360 209 L 351 203 L 351 215 Z" fill="rgba(244,113,113,.85)"/>';
    d+='<text x="348" y="236" font-size="11" style="fill:var(--red,#f87171)" text-anchor="middle">抽真空</text>';
    /* 操作与安全要点卡 */
    d+='<rect x="340" y="304" width="166" height="50" rx="8" style="fill:var(--card,#1a2235);stroke:rgba(244,113,113,.35);stroke-width:1"/>'
      +'<text x="350" y="320" font-size="10.5" style="fill:var(--red,#f87171)">⚠ 操作要点</text>'
      +'<text x="350" y="336" font-size="10" style="fill:var(--t2,#94a3b8)">① 滤纸叠菊花形/圆锥并润湿贴合</text>'
      +'<text x="350" y="349" font-size="10" style="fill:var(--t2,#94a3b8)">② 抽滤瓶铁架固定 · 先停泵、再拔管防倒吸</text>';
    /* 底部说明 */
    d+='<text x="20" y="326" font-size="11.5" style="fill:var(--t2,#94a3b8)">装置：铁架台 + 布氏漏斗（滤纸）+ 抽滤瓶 + 胶管 + 真空泵</text>';
    d+='<text x="20" y="342" font-size="11" style="fill:var(--t3,#64748b)">真空度要稳：先开泵、再倒料；勿中途关泵倒吸，应从漏斗口离开并拔胶管放气。</text>';
    return vizWrap(vizsvg(W,H,d),'🧪 '+(escText(q||'抽滤装置示意')));
  }

  /* ---- TG-DSC 组合热分析（示意曲线，非双轴混标） ---- */
  function buildThermalViz(q){
    var d='',W=560,H=376;
    var xL=80,xR=520, tgTop=38,tgBot=128, dscTop=168,dscBot=252;
    function tX(T){ return xL+(xR-xL)*(T/400); }
    function yTg(m){ return tgTop+(100-m)/100*(tgBot-tgTop); }
    /* TG 轴 + 框 */
    d+='<text x="'+xL+'" y="30" font-size="13" style="fill:var(--t1,#f1f5f9)">TG（质量保留率 / %）</text>';
    d+='<rect x="'+xL+'" y="'+tgTop+'" width="'+(xR-xL)+'" height="'+(tgBot-tgTop)+'" fill="none" stroke="rgba(148,163,184,.35)"/>';
    for(var p=0;p<=2;p++){ var pm=100-p*10; var py=tgBot-(p/2)*(tgBot-tgTop); d+='<text x="'+(xL-6)+'" y="'+(py+4)+'" font-size="10.5" style="fill:var(--t3,#64748b)" text-anchor="end">'+pm+'</text>'; }
    for(var tt=100;tt<=300;tt+=100){ var gx=tX(tt); d+='<line x1="'+gx+'" y1="'+tgTop+'" x2="'+gx+'" y2="'+tgBot+'" stroke="rgba(148,163,184,.14)"/>'; }
    /* TG 曲线（脱水→无水→草酸根分解） */
    var tgPts=[['40',100],['85',100],['115',89],['290',89],['330',55],['360',55]].map(function(pr){ return tX(+pr[0])+','+yTg(+pr[1]); }).join(' ');
    d+='<polyline points="'+tgPts+'" fill="none" stroke="var(--em,#10b981)" stroke-width="2.5"/>';
    d+=markerRect(tX(100), yTg(94.5), 'var(--em,#10b981)');
    d+=markerRect(tX(310), yTg(72), 'var(--em,#10b981)');
    d+='<text x="'+(tX(100)+10)+'" y="'+(yTg(94.5)-8)+'" font-size="10.5" style="fill:var(--em,#10b981)">~100℃ 失水 Δm≈11%</text>';
    d+='<text x="'+(tX(310)+10)+'" y="'+(yTg(72)-8)+'" font-size="10.5" style="fill:var(--em,#10b981)">~300℃ 草酸根分解</text>';
    /* DSC 轴 + 框 */
    d+='<text x="'+xL+'" y="'+dscTop+'" font-size="13" style="fill:var(--t1,#f1f5f9)">DSC（热流 · 示意 / 吸热为下凹）</text>';
    d+='<rect x="'+xL+'" y="'+dscTop+'" width="'+(xR-xL)+'" height="'+(dscBot-dscTop)+'" fill="none" stroke="rgba(148,163,184,.35)"/>';
    var dscMid=dscTop+(dscBot-dscTop)/2;
    d+='<line x1="'+tX(30)+'" y1="'+dscMid+'" x2="'+tX(370)+'" y2="'+dscMid+'" stroke="rgba(148,163,184,.4)" stroke-dasharray="3 3"/>';
    /* 吸热谷 @100℃（下凹） */
    d+='<polyline points="'+(tX(165))+','+dscMid+' '+(tX(190))+','+(dscMid+30)+' '+(tX(215))+','+dscMid+'" fill="none" stroke="var(--red,#f87171)" stroke-width="2.5"/>';
    /* 放热峰 @310℃（上凸） */
    d+='<polyline points="'+(tX(395))+','+dscMid+' '+(tX(421))+','+(dscMid-30)+' '+(tX(447))+','+dscMid+'" fill="none" stroke="var(--yellow,#fbbf24)" stroke-width="2.5"/>';
    d+='<text x="'+(tX(190))+'" y="'+(dscMid+42)+'" font-size="11" style="fill:var(--red,#f87171)" text-anchor="middle">吸热 · 脱结晶水</text>';
    d+='<text x="'+(tX(421))+'" y="'+(dscMid-42)+'" font-size="11" style="fill:var(--yellow,#fbbf24)" text-anchor="middle">放热 · 草酸根分解</text>';
    /* 共享 x 轴温度 */
    for(var t2=100;t2<=300;t2+=100){ var gx2=tX(t2); d+='<text x="'+gx2+'" y="'+(dscBot+18)+'" font-size="10.5" style="fill:var(--t3,#64748b)" text-anchor="middle">'+t2+'</text>'; }
    d+='<text x="'+(xL-6)+'" y="'+(dscBot+18)+'" font-size="10.5" style="fill:var(--t3,#64748b)" text-anchor="middle">0</text>';
    d+='<text x="'+(xL+(xR-xL)/2)+'" y="'+(dscBot+34)+'" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">温度 / ℃</text>';
    /* 图例 */
    d+='<text x="'+xL+'" y="'+(H-86)+'" font-size="11" style="fill:var(--t2,#94a3b8)">—— 绿：TG 质量保留率</text>';
    d+='<circle cx="'+(xL+200)+'" cy="'+(H-91)+'" r="4" fill="var(--red,#f87171)"/><text x="'+(xL+210)+'" y="'+(H-86)+'" font-size="11" style="fill:var(--t2,#94a3b8)">吸热峰</text>';
    d+='<circle cx="'+(xL+300)+'" cy="'+(H-91)+'" r="4" fill="var(--yellow,#fbbf24)"/><text x="'+(xL+310)+'" y="'+(H-86)+'" font-size="11" style="fill:var(--t2,#94a3b8)">放热峰</text>';
    /* 分步反应注解 */
    d+='<rect x="'+xL+'" y="'+(H-76)+'" width="'+(xR-xL)+'" height="26" rx="6" style="fill:rgba(45,212,191,.06);stroke:rgba(45,212,191,.3);stroke-width:1"/>'
      +'<text x="'+(xL+10)+'" y="'+(H-59)+'" font-size="10.5" style="fill:var(--em,#10b981)">① ~100℃　K₃[Fe(C₂O₄)₃]·3H₂O → K₃[Fe(C₂O₄)₃] + 3H₂O↑（Δm≈54/491≈11%，吸热）</text>';
    d+='<rect x="'+xL+'" y="'+(H-46)+'" width="'+(xR-xL)+'" height="26" rx="6" style="fill:rgba(244,113,113,.06);stroke:rgba(244,113,113,.3);stroke-width:1"/>'
      +'<text x="'+(xL+10)+'" y="'+(H-29)+'" font-size="10.5" style="fill:var(--red,#f87171)">② ~300℃　草酸根分解放出 CO/CO₂↑，残余 Fe₂O₃ + K₂CO₃（放热）</text>';
    d+='<text x="'+xL+'" y="'+(H-10)+'" font-size="10.5" style="fill:var(--t3,#64748b)">气氛：N₂ 保护或静态空气 · 升温约 10℃/min · 用失重量可反推结晶水个数（3 个）</text>';
    return vizWrap(vizsvg(W,H,d),'🔥 '+(escText(q||'TG-DSC 热分析')));
  }
  function markerRect(x,y,color){ return '<rect x="'+(x-4)+'" y="'+(y-4)+'" width="8" height="8" fill="'+color+'"/>'; }

  /* ---- 配合物立体结构：八面体 + 3×双齿草酸根螯合 ---- */
  function buildComplexViz(q){
    var W=520,H=344,cx=260,cy=150,R=90,d='',O=[];
    for(var k=0;k<6;k++){ var a=-90+k*60, x=cx+R*Math.cos(a*Math.PI/180), y=cy+R*Math.sin(a*Math.PI/180); O.push({x:x,y:y}); }
    for(var i=0;i<6;i++){ d+='<line x1="'+cx+'" y1="'+cy+'" x2="'+O[i].x+'" y2="'+O[i].y+'" stroke="rgba(45,212,191,.5)" stroke-width="2"/>'; }
    var pairs=[[0,1],[2,3],[4,5]];
    for(var p=0;p<pairs.length;p++){
      var A=O[pairs[p][0]], B=O[pairs[p][1]];
      var mx=(A.x+B.x)/2, my=(A.y+B.y)/2;
      var dx=B.x-A.x, dy=B.y-A.y, len=Math.hypot(dx,dy)||1;
      var nx=-dy/len, ny=dx/len;
      var c1x=mx+nx*34+dx*0.05, c1y=my+ny*34+dy*0.05;
      /* 两个碳原子沿法向外推，桥接双齿 O（五元螯合环 Fe-O-C-C-O） */
      var c2x=mx+nx*34-dx*0.05, c2y=my+ny*34-dy*0.05;
      d+='<path d="M '+A.x+' '+A.y+' L '+c1x+' '+c1y+' L '+c2x+' '+c2y+' L '+B.x+' '+B.y+'" fill="none" stroke="rgba(167,139,250,.75)" stroke-width="2.5"/>';
      var lx=mx+nx*54, ly=my+ny*54;
      d+='<text x="'+lx+'" y="'+ly+'" font-size="11" style="fill:var(--purple,#a78bfa)" text-anchor="middle">C₂O₄²⁻</text>';
    }
    d+='<circle cx="'+cx+'" cy="'+cy+'" r="22" fill="var(--em,#10b981)" stroke="var(--t1,#f1f5f9)" stroke-width="2"/>'
      +'<text x="'+cx+'" y="'+(cy+5)+'" font-size="13" style="fill:#0b1020" text-anchor="middle">Fe³⁺</text>';
    for(var o=0;o<6;o++){ d+='<circle cx="'+O[o].x+'" cy="'+O[o].y+'" r="10" style="fill:rgba(45,212,191,.25);stroke:rgba(45,212,191,.7);stroke-width:1.5"/>'
      +'<text x="'+O[o].x+'" y="'+(O[o].y+4)+'" font-size="10.5" style="fill:var(--teal,#2dd4bf)" text-anchor="middle">O</text>'; }
    d+='<text x="'+cx+'" y="28" font-size="14" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">[Fe(C₂O₄)₃]³⁻ · 八面体配位</text>';
    d+='<text x="'+cx+'" y="302" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">配位数 6 = 3 × 双齿 C₂O₄²⁻（每个配体贡献 2 个 O 配位原子）· 各成五元螯合环</text>';
    d+='<text x="'+cx+'" y="318" font-size="11" style="fill:var(--t3,#64748b)" text-anchor="middle">正八面体：相邻 O-Fe-O 约 90°、对位 180° · 草酸/水弱场 → 高自旋 d⁵ → 磁矩≈5.92 BM</text>';
    d+='<text x="'+cx+'" y="334" font-size="11" style="fill:var(--t3,#64748b)" text-anchor="middle">可拆分 Δ / Λ 手性对映体（见手性图）· 产物 K₃[Fe(C₂O₄)₃]·3H₂O 翠绿、见光易分解</text>';
    return vizWrap(vizsvg(W,H,d),'🧬 '+(escText(q||'配合物立体结构')));
  }

  /* ---- 手性对映：Δ / Λ 互为镜像 ---- */
  function buildIsomerViz(q){
    var W=600,H=300,d='';
    function propeller(cx,cy){
      var s='';
      for(var i=0;i<3;i++){
        var a=(i*120-90)*(Math.PI/180);
        var ex=cx+108*Math.cos(a), ey=cy+108*Math.sin(a);
        var px=-Math.sin(a)*15, py=Math.cos(a)*15;
        s+='<path d="M '+cx+' '+cy+' L '+(ex+px)+' '+(ey+py)+' L '+(ex-px)+' '+(ey-py)+' Z" style="fill:rgba(96,165,250,.22);stroke:rgba(96,165,250,.8);stroke-width:2"/>';
      }
      s+='<circle cx="'+cx+'" cy="'+cy+'" r="20" fill="var(--em,#10b981)" stroke="var(--t1,#f1f5f9)" stroke-width="2"/>'
        +'<text x="'+cx+'" y="'+(cy+5)+'" font-size="12" style="fill:#0b1020" text-anchor="middle">Fe</text>';
      return s;
    }
    d+=propeller(180,160); d+=propeller(420,160);
    d+='<line x1="300" y1="52" x2="300" y2="250" stroke="rgba(244,113,113,.7)" stroke-width="3" stroke-dasharray="9 6"/>'
      +'<text x="300" y="44" font-size="11.5" style="fill:var(--red,#f87171)" text-anchor="middle">镜面</text>';
    /* 螺旋方向指示 */
    d+='<path d="M 232 110 A 62 62 0 0 1 232 210" fill="none" stroke="var(--yellow,#fbbf24)" stroke-width="2.5"/>'
      +'<path d="M 232 210 L 224 188 L 240 188 Z" fill="var(--yellow,#fbbf24)"/>';
    d+='<path d="M 368 210 A 62 62 0 0 1 368 110" fill="none" stroke="var(--yellow,#fbbf24)" stroke-width="2.5"/>'
      +'<path d="M 368 110 L 360 132 L 376 132 Z" fill="var(--yellow,#fbbf24)"/>';
    d+='<text x="180" y="52" font-size="15" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">Δ</text><text x="180" y="278" font-size="11" style="fill:var(--t2,#94a3b8)" text-anchor="middle">左旋（螺旋向上）</text>';
    d+='<text x="420" y="52" font-size="15" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">Λ</text><text x="420" y="278" font-size="11" style="fill:var(--t2,#94a3b8)" text-anchor="middle">右旋（螺旋向上）</text>';
    d+='<text x="300" y="22" font-size="14" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">Δ- / Λ-[Fe(C₂O₄)₃]³⁻ 手性对映</text>';
    d+='<text x="300" y="294" font-size="11.5" style="fill:var(--t2,#94a3b8)" text-anchor="middle">Δ 与 Λ 互为镜像、不可重叠 → 旋光异构；等量混合为外消旋体（无旋光性）</text>';
    return vizWrap(vizsvg(W,H,d),'🪞 '+(escText(q||'手性异构')));
  }

  /* ---- KMnO₄ 滴定草酸根：S 形滴定曲线 ---- */
  function buildTitrationViz(q){
    var W=560,H=352,xL=92,xR=512,yT=48,yB=244,d='';
    function xV(v){ return xL+(xR-xL)*(v/24); }
    function yE(e){ return yB-(e-0.4)/(1.6-0.4)*(yB-yT); }
    d+='<line x1="'+xL+'" y1="'+yB+'" x2="'+xR+'" y2="'+yB+'" stroke="rgba(148,163,184,.5)" stroke-width="2"/>';
    d+='<line x1="'+xL+'" y1="'+yB+'" x2="'+xL+'" y2="'+yT+'" stroke="rgba(148,163,184,.5)" stroke-width="2"/>';
    d+='<text x="'+(xL-12)+'" y="'+(yT-10)+'" font-size="12" style="fill:var(--t2,#94a3b8)">电极电位 E / mV</text>';
    d+='<text x="'+((xL+xR)/2)+'" y="'+(yB+26)+'" font-size="12" style="fill:var(--t2,#94a3b8)" text-anchor="middle">滴入 KMnO₄ 体积 V / mL</text>';
    for(var g=0;g<=3;g++){ var e=0.4+g*0.4, gy=yE(e); d+='<line x1="'+xL+'" y1="'+gy+'" x2="'+xR+'" y2="'+gy+'" stroke="rgba(148,163,184,.12)"/>'; d+='<text x="'+(xL-6)+'" y="'+(gy+4)+'" font-size="10" style="fill:var(--t3,#64748b)" text-anchor="end">'+e.toFixed(1)+'</text>'; }
    var pts=[]; for(var i=0;i<=48;i++){ var v=i/48*24, e=0.4+1.1/(1+Math.exp(-(v-11)/0.9)); pts.push(xV(v).toFixed(1)+','+yE(e).toFixed(1)); }
    d+='<polyline points="'+pts.join(' ')+'" fill="none" stroke="var(--em,#10b981)" stroke-width="2.5"/>';
    var ve=xV(11), ej=yE(1.4);
    d+='<line x1="'+ve+'" y1="'+yB+'" x2="'+ve+'" y2="'+ej+'" stroke="rgba(244,113,113,.7)" stroke-width="2" stroke-dasharray="4 4"/>'
      +'<text x="'+(ve+8)+'" y="'+(yB-8)+'" font-size="11" style="fill:var(--red,#f87171)">计量点 Ve（紫红色突跃）</text>';
    d+='<text x="'+xL+'" y="'+(yT+2)+'" font-size="11.5" style="fill:var(--t2,#94a3b8)">2MnO₄⁻ + 5C₂O₄²⁻ + 16H⁺ → 2Mn²⁺ + 10CO₂↑ + 8H₂O</text>';
    d+='<text x="'+xL+'" y="'+(yT+20)+'" font-size="11" style="fill:var(--t2,#94a3b8)">KMnO₄ 自指示：终点后微量过量即显紫红色且不褪</text>';
    d+='<text x="'+xL+'" y="'+(yB+14)+'" font-size="11" style="fill:var(--t3,#64748b)">滴定体积 0 →（计量点）紫红突跃</text>';
    d+='<text x="'+xL+'" y="'+(yB+42)+'" font-size="11" style="fill:var(--t3,#64748b)">用于标定铁/草酸根含量，反推配位比 Fe : C₂O₄²⁻ = 1 : 3</text>';
    /* 计量关系卡 */
    d+='<rect x="'+xL+'" y="'+(yB+54)+'" width="'+(xR-xL)+'" height="24" rx="6" style="fill:rgba(16,185,129,.06);stroke:rgba(16,185,129,.3);stroke-width:1"/>'
      +'<text x="'+(xL+10)+'" y="'+(yB+70)+'" font-size="10.5" style="fill:var(--em,#10b981)">计量关系　n(C₂O₄²⁻) : n(MnO₄⁻) = 5 : 2　（由 2MnO₄⁻+5C₂O₄²⁻+16H⁺ 反应式）</text>';
    /* 条件卡 */
    d+='<rect x="'+xL+'" y="'+(yB+82)+'" width="'+(xR-xL)+'" height="24" rx="6" style="fill:rgba(96,165,250,.06);stroke:rgba(96,165,250,.3);stroke-width:1"/>'
      +'<text x="'+(xL+10)+'" y="'+(yB+98)+'" font-size="10.5" style="fill:var(--blue,#60a5fa)">条件　75~85℃ 强酸（H₂SO₄）介质 · KMnO₄ 自指示 · 无色 Mn²⁺ → 微过量显紫红</text>';
    return vizWrap(vizsvg(W,H,d),'🧪 '+(escText(q||'滴定曲线')));
  }

  /* ---- 氧化还原电对：E° 一览 ---- */
  function buildRedoxViz(q){
    var W=560,H=336,d='';
    var rows=[["H₂O₂/H₂O","+1.77 V","H₂O₂ + 2H⁺ + 2e⁻ → 2H₂O（本实验氧化剂，绿色）","var(--purple,#a78bfa)"],["MnO₄⁻/Mn²⁺","+1.51 V","MnO₄⁻ + 8H⁺ + 5e⁻ → Mn²⁺ + 4H₂O（很强氧化剂）","var(--teal,#2dd4bf)"],["Fe³⁺/Fe²⁺","+0.77 V","Fe³⁺ + e⁻ → Fe²⁺（本实验铁以 +3 价存在）","var(--em,#10b981)"],["C₂O₄²⁻/CO₂","-0.49 V","C₂O₄²⁻ → 2CO₂ + 2H⁺ + 2e⁻（草酸根作还原剂）","var(--red,#f87171)"]];
    d+='<text x="'+W/2+'" y="24" font-size="14" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">关键氧化还原电对（E° / V，相对标准氢电极）</text>';
    for(var i=0;i<rows.length;i++){
      var y0=44+i*60, r=rows[i];
      d+='<rect x="40" y="'+y0+'" width="480" height="50" rx="10" style="fill:var(--card,#1a2235);stroke:rgba(148,163,184,.25);stroke-width:1"/>';
      d+='<circle cx="64" cy="'+(y0+25)+'" r="6" fill="'+r[3]+'"/>';
      d+='<text x="80" y="'+(y0+22)+'" font-size="13" style="fill:var(--t1,#f1f5f9)">'+escText(r[0])+'</text>';
      d+='<text x="80" y="'+(y0+40)+'" font-size="10.5" style="fill:var(--t3,#64748b)">'+escText(r[2])+'</text>';
      d+='<text x="500" y="'+(y0+29)+'" font-size="14" style="fill:'+r[3]+'" text-anchor="end" font-weight="bold">'+escText(r[1])+'</text>';
    }
    /* ΔE° 自发判定 */
    d+='<rect x="40" y="'+(44+4*60+8)+'" width="480" height="44" rx="8" style="fill:rgba(16,185,129,.06);stroke:rgba(16,185,129,.35);stroke-width:1"/>'
      +'<text x="52" y="'+(44+4*60+24)+'" font-size="11.5" style="fill:var(--em,#10b981)">自发判定：E°(H₂O₂/H₂O) − E°(Fe³⁺/Fe²⁺) = 1.77 − 0.77 = <b>+1.00 V</b> ＞ 0</text>'
      +'<text x="52" y="'+(44+4*60+41)+'" font-size="10.5" style="fill:var(--t2,#94a3b8)">→ H₂O₂ 足以把 Fe²⁺ 氧化为 Fe³⁺；草酸根（-0.49 V）作还原剂，与高锰酸钾之间 ΔE°≈2.0 V 也易于反应</text>';
    return vizWrap(vizsvg(W,H,d),'⚡ '+(escText(q||'氧化还原电位')));
  }

  /* ---- 实验安全要点 ---- */
  function buildSafetyViz(q){
    var W=560,H=232,d='';
    var tiles=[["护目镜","戴护目镜 · 通风橱内操作","⚠"],["手套","防 H₂O₂ / 酸腐蚀，戴手套","🧤"],["远离火源","乙醇易挥发易燃，禁明火","🔥"],["H₂O₂ 强氧化","勿接触皮肤，溅到即冲水","🌀"],["加热安全","水浴/石棉网隔热，勿徒手","♨"],["意外处理","酸 / H₂O₂ 溅淋 → 清水冲洗","💧"],["废液回收","含草酸/铁废液分类回收","🗑"],["避光保存","产物见光易分解，密封避光","🌑"]];
    var cols=4, tw=126, th=64, gx=20, gy=52, gap=10;
    for(var i=0;i<tiles.length;i++){
      var cx=gx+(i%cols)*(tw+gap), cy=gy+Math.floor(i/cols)*(th+gap);
      var col=['var(--yellow,#fbbf24)','var(--red,#f87171)','var(--blue,#60a5fa)'][i%3];
      d+='<rect x="'+cx+'" y="'+cy+'" width="'+tw+'" height="'+th+'" rx="10" style="fill:var(--card,#1a2235);stroke:'+col+';stroke-width:1.5"/>';
      d+='<text x="'+(cx+tw/2)+'" y="'+(cy+22)+'" font-size="15" text-anchor="middle">'+tiles[i][2]+'</text>';
      d+='<text x="'+(cx+tw/2)+'" y="'+(cy+40)+'" font-size="12" style="fill:var(--t1,#f1f5f9)" text-anchor="middle" font-weight="bold">'+escText(tiles[i][0])+'</text>';
      d+='<text x="'+(cx+tw/2)+'" y="'+(cy+56)+'" font-size="10" style="fill:var(--t2,#94a3b8)" text-anchor="middle">'+escText(tiles[i][1])+'</text>';
    }
    d+='<text x="'+W/2+'" y="34" font-size="14" style="fill:var(--t1,#f1f5f9)" text-anchor="middle">⚠ 三草酸合铁酸钾制备实验 · 安全要点</text>';
    d+='<text x="'+W/2+'" y="'+((H-14))+'" font-size="11" style="fill:var(--t3,#64748b)" text-anchor="middle">涉及酸碱、强氧化剂与易燃溶剂，请先咨询老师再动手 · 实验台整洁、废液妥善分类回收</text>';
    return vizWrap(vizsvg(W,H,d),'🛡 '+(escText(q||'实验安全')));
  }

  /* ---- 知识图谱真图（节点-边，按 category 着色） ---- */
  var KG_COLOR={center:'#34d399',coordination:'#fbbf24',redox:'#f43f5e',analytical:'#38bdf8',physical:'#a78bfa'};
  function catColor(c){ return KG_COLOR[c]||'#94a3b8'; }
  function buildKnowGraphViz(q,kg){
    if(!kg||!kg.nodes||!kg.nodes.length){
      return vizWrap('<div style="font-size:13px;color:var(--t3,#64748b)">知识图谱数据暂未加载。<a href="knowledge.html" style="color:var(--teal,#2dd4bf)">前往知识图谱页查看完整关系网 →</a>；也可改用「画出三步反应的流程图」提问。</div>','🕸 知识图谱');
    }
    var nodes=kg.nodes, links=kg.links||[];
    var byId={}; nodes.forEach(function(n){ byId[n.id]=n; });
    var center=null;
    for(var i=0;i<nodes.length;i++){ if(/三草酸|三\(草酸|\[Fe\(C2O4\)3\]|K3\[Fe/i.test(nodes[i].name||'')){ center=nodes[i]; break; } }
    if(!center&&nodes.length) center=nodes[0];
    var neighIds=[], edgeByTgt={};
    for(var j=0;j<links.length;j++){ var e=links[j]; if(e.source===center.id||e.target===center.id){ var other=(e.source===center.id)?e.target:e.source; if(neighIds.indexOf(other)<0) neighIds.push(other); edgeByTgt[other]=e; } }
    if(center.relatedNodes){ for(var k=0;k<center.relatedNodes.length;k++){ var rn=center.relatedNodes[k]; if(byId[rn]&&neighIds.indexOf(rn)<0) neighIds.push(rn); } }
    if(!neighIds.length){ neighIds=nodes.slice(0,10).map(function(n){return n.id;}).filter(function(id){return id!==center.id;}); }
    neighIds=neighIds.slice(0,10);
    var W=560,H=322,cx=280,cy=160,R=104,d='';
    var centerNode={x:cx,y:cy,r:26};
    /* 边 */
    for(var m=0;m<neighIds.length;m++){
      var ang=-90+m*(360/neighIds.length), rad=ang*Math.PI/180;
      var nx=cx+R*Math.cos(rad), ny=cy+R*Math.sin(rad);
      var eg=byId[neighIds[m]]||{}, e=edgeByTgt[neighIds[m]];
      var sw=(e&&e.lineStyle&&e.lineStyle.width)||2;
      var sc=(e&&e.lineStyle&&e.lineStyle.color)||'rgba(148,163,184,.5)';
      var dash=(e&&e.lineStyle&&e.lineStyle.type==='dashed')?'stroke-dasharray="6 5"':'';
      d+='<line x1="'+centerNode.x+'" y1="'+centerNode.y+'" x2="'+nx+'" y2="'+ny+'" stroke="'+sc+'" stroke-width="'+sw+'" '+dash+'/>';
    }
    /* 节点 */
    d+='<circle cx="'+centerNode.x+'" cy="'+centerNode.y+'" r="'+centerNode.r+'" fill="'+catColor(center.category)+'" stroke="var(--t1,#f1f5f9)" stroke-width="2"/>'
      +'<text x="'+centerNode.x+'" y="'+(centerNode.y+5)+'" font-size="11.5" style="fill:#0b1020" text-anchor="middle">'+escText(shortName(center.name))+'</text>';
    for(var qq=0;qq<neighIds.length;qq++){
      var ang2=-90+qq*(360/neighIds.length), rad2=ang2*Math.PI/180;
      var nX=cx+R*Math.cos(rad2), nY=cy+R*Math.sin(rad2);
      var nd=byId[neighIds[qq]]||{}, r=18;
      d+='<circle cx="'+nX+'" cy="'+nY+'" r="'+r+'" fill="'+catColor(nd.category)+'" stroke="var(--t1,#f1f5f9)" stroke-width="1.5"/>';
      var anchor=(Math.cos(rad2)>=0)?'start':'end', lx=nX+(Math.cos(rad2)>=0?r+7:-r-7);
      d+='<text x="'+lx+'" y="'+(nY+4)+'" font-size="11.5" style="fill:var(--t1,#f1f5f9)" text-anchor="'+anchor+'">'+escText(shortName(nd.name))+'</text>';
    }
    /* 图例 */
    var seenCats=[], order=['center','coordination','redox','analytical','physical'];
    var someCats=[center.category].concat(neighIds.map(function(id){ return byId[id]&&byId[id].category; }));
    for(var cc=0;cc<someCats.length;cc++){ var c2=someCats[cc]; if(c2&&seenCats.indexOf(c2)<0&&seenCats.length<4) seenCats.push(c2); }
    var lx2=84, ly=296;
    for(var g=0;g<seenCats.length;g++){ var lc=catColor(seenCats[g]); d+='<circle cx="'+lx2+'" cy="'+(ly-4)+'" r="5" fill="'+lc+'"/>'+( '<text x="'+(lx2+9)+'" y="'+ly+'" font-size="10.5" style="fill:var(--t2,#94a3b8)">'+escText(catLabel(seenCats[g]))+'</text>' ); lx2+=110; }
    d+='<text x="392" y="'+(ly-4)+'" font-size="10.5" style="fill:var(--t2,#94a3b8)">—— 实线：强相关　⤍ 虚线：弱相关</text>';
    d+='<a href="knowledge.html" style="text-decoration:none"><text x="392" y="'+(ly+16)+'" font-size="11.5" style="fill:var(--teal,#2dd4bf)">在知识图谱页查看完整 →</text></a>';
    return vizWrap(vizsvg(W,H,d),'🕸 '+(escText(center.name||'知识图谱')));
  }
  function shortName(nm){ return String(nm||'').replace(/\s+/g,' ').slice(0,14); }
  function catLabel(c){ return {center:'中心',coordination:'配位',redox:'氧化还原',analytical:'分析',physical:'物性'}[c]||c; }

  /* ---- 知识图谱数据加载（缓存） ---- */
  var _kgCache=null;
  function loadKG(){
    if(_kgCache&&_kgCache.then) return _kgCache;
    _kgCache=new Promise(function(res,rej){
      try{ (window.fetch||fetch)('data/kg.json').then(function(r){ return r.json(); }).then(function(j){ res({nodes:j.nodes||[],links:j.links||[]}); }).catch(rej); }
      catch(e){ rej(e); }
    }).catch(function(e){ _kgCache=null; throw e; });
    return _kgCache;
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
        +'<div class="kp-bar" style="margin-top:10px"><i style="width:'+Math.min(100,Math.round(m.total||0))+'%;background:var(--grad)"></i></div>'
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
    detectVizType:detectVizType,
    loadKG:loadKG,
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
