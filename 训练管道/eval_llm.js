/**
 * LLM RAG evaluation: test 20 Round 3 questions through the full pipeline
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readJSON } = require('../scripts/rag-utils');

const QUESTIONS = readJSON(path.join(__dirname, '..', '试题迭代记录/round3/test_questions_round3.json'));
const KB = readJSON(path.join(__dirname, '..', '_archive', 'data_dev', 'kb.json'));
const FAQ = readJSON(path.join(__dirname, '..', 'data', 'faq_unified.json'));
const CORPUS = readJSON(path.join(__dirname, '..', 'data', 'corpus.json'));

const API_KEY = process.env.DEEPSEEK_KEY || '';
if (!API_KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量，请先设置后运行');
  process.exit(1);
}
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// ===== Simplified local search (same logic as assistant.html) =====
const SUBMAP = {'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','⁻':'-','⁺':'+'};
const norm = s => String(s||'').toLowerCase().replace(/[₀-₉⁻⁺]/g, c => SUBMAP[c] || c).replace(/\s+/g, '');
const AMBIGUOUS = new Set(['℃','°c','40','40℃','100','100℃','0','0℃','20','20℃','g','ml','mol','%','h','ph','水','酸','碱','盐','色','热','光','铁','氧','氢','碳']);

// NOTE: local matchFAQ/kbTokens retained for custom scoring logic
function matchFAQ(q) {
  const nq = norm(q); let best = null, bestScore = 0;
  for (const f of FAQ) {
    let kh = 0, specificHits = 0;
    for (const k of (f.keys || [])) {
      const nk = norm(k); if (nk.length < 2 || AMBIGUOUS.has(nk)) continue;
      if (nq.includes(nk)) { kh++; if (nk.length >= 4) specificHits++; }
    }
    let eh = 0;
    for (const en of (f.ents || [])) {
      if (norm(en).length >= 2 && nq.includes(norm(en))) eh++;
    }
    // Bigram overlap
    const faqText = norm((f.title||'') + ' ' + (f.answer||''));
    const faqBigrams = new Set();
    for (let i = 0; i < faqText.length - 1; i++) faqBigrams.add(faqText.slice(i, i + 2));
    const qBigrams = new Set();
    for (let i = 0; i < nq.length - 1; i++) qBigrams.add(nq.slice(i, i + 2));
    let bg = 0; for (const b of qBigrams) { if (faqBigrams.has(b)) bg++; }
    const score = kh * 3 + specificHits * 6 + eh * 8 + Math.min(bg * 0.4, 15);
    const trig = (kh >= 1) || (eh >= 1) || (bg >= 15);
    if (trig && score >= bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function kbTokens(text) {
  const s = norm(String(text || '')); const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[一-鿿]/.test(c)) { let j = i; while (j < s.length && /[一-鿿]/.test(s[j])) j++; const run = s.slice(i, j); for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2)); i = j; }
    else if (/[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(c)) { let j = i; while (j < s.length && /[a-z0-9·+\-°℃%()\[\]⁺⁻]/.test(s[j])) j++; const tk = s.slice(i, j); if (tk.length >= 2 || /\d/.test(tk)) out.push(tk); i = j; }
    else i++;
  }
  return out;
}

let BM25_IDX = null;
function kbIndex() {
  if (BM25_IDX) return BM25_IDX;
  const docs = KB.map(en => { const parts = []; kbTokens(en.topic||'').forEach(x=>{parts.push(x,x,x);}); kbTokens((en.keys||[]).join(', ')).forEach(x=>{parts.push(x,x);}); kbTokens(en.answer||'').forEach(x=>parts.push(x)); const tf={}; parts.forEach(x=>tf[x]=(tf[x]||0)+1); return {en,tf,len:parts.length||1}; });
  const df={}; let tot=0; docs.forEach(d=>{tot+=d.len; for(const t in d.tf)df[t]=(df[t]||0)+1;});
  BM25_IDX={docs,df,avgdl:tot/(docs.length||1),N:docs.length}; return BM25_IDX;
}
function bm25MatchKB(q) {
  const idx=kbIndex(); const qtoks=kbTokens(q).filter(t=>t.length>=2); const nq=norm(q); const k1=1.5,b=0.75; const arr=[];
  for(const d of idx.docs) { let sc=0; for(const t of qtoks){const f=d.tf[t]; if(!f)continue; const idf=Math.log(1+(idx.N-idx.df[t]+0.5)/(idx.df[t]+0.5)); sc+=idf*(f*(k1+1))/(f+k1*(1-b+b*d.len/idx.avgdl));} for(const k of(d.en.keys||[])){const nk=norm(k); if(nk.length>=3&&nq.includes(nk))sc+=6;} for(const t of(d.en.ents||[])){const nt=norm(t); if(nt.length>=2&&nq.includes(nt))sc+=8;} if(sc<=0)continue; arr.push({en:d.en,score:sc}); }
  if(!arr.length)return null; arr.sort((a,b)=>b.score-a.score); if(arr[0].score<3.0)return null;
  return {entry:arr[0].en,score:arr[0].score,second:arr[1]?arr[1].en:null,third:arr[2]?arr[2].en:null};
}

function buildContext(q) {
  const parts = [];
  const faq = matchFAQ(q);
  if (faq) parts.push('【FAQ · ' + faq.title + '】\n' + (faq.answer || '') + (faq.detail ? '\n' + faq.detail : ''));
  const m = bm25MatchKB(q);
  if (m) {
    parts.push('【KB · ' + m.entry.topic + '】\n' + (m.entry.answer || ''));
    if (m.second && m.secondScore >= m.score*0.4) parts.push('【KB补充 · ' + m.second.topic + '】\n' + (m.second.answer || ''));
  }
  const CHEATSHEET = '【实验关键参数】莫尔盐M=392.14g/mol | 产物M=491.25g/mol | 标准5.0g莫尔盐→理论6.26g | 氧化40℃ | 结晶水失重100℃ | 草酸pKa1=1.25 pKa2=4.27 | H2O2 φ°=+1.77V | Fe3+/Fe2+ φ°=+0.771V | [Fe(C2O4)3]3- lgKf≈20.2 | 高自旋d5 μeff≈5.92BM';
  parts.push(CHEATSHEET);
  return parts.join('\n\n---\n\n');
}

function callLLM(question, context) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-flash',
      messages: [
        {role:'system', content:'你是ChemAI实验助手。严格基于参考内容回答。标注来源。如无参考内容说知识清单未命中。'},
        {role:'system', content: context},
        {role:'user', content: question}
      ],
      max_tokens: 400, temperature: 0.3
    });
    const req = https.request(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices[0].message.content); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', e => reject(e));
    req.write(body); req.end();
  });
}

function evaluateAnswer(q, aiAnswer) {
  const aiN = norm(aiAnswer);
  const ansN = norm(q.answer);
  const explN = norm(q.explanation || '');
  let score = 0;

  switch (q.type) {
    case 'fill': {
      const words = ansN.split(/[,，、\s]+/).filter(w => w.length >= 2);
      const hits = words.filter(w => aiN.includes(w)).length;
      const ratio = hits / Math.max(1, words.length);
      if (ratio >= 0.7) score = 3; else if (ratio >= 0.4) score = 2; else if (ratio >= 0.2) score = 1;
      // Also check explanation coverage
      if (score < 2) {
        const expWords = explN.split(/[。；\s]+/).filter(w => w.length >= 6);
        const expHits = expWords.filter(w => aiN.includes(w)).length;
        if (expHits >= Math.ceil(expWords.length * 0.3) && expWords.length >= 2) score = 2;
      }
      break;
    }
    case 'short': {
      const sentences = explN.split(/[。；]/).filter(s => s.length >= 8);
      let covered = 0;
      for (const s of sentences) {
        const key = s.slice(0, Math.min(20, s.length));
        if (key.length >= 4 && aiN.includes(key)) covered++;
      }
      const cov = covered / Math.max(1, sentences.length);
      if (cov >= 0.25) score = 3; else if (cov >= 0.1) score = 2; else if (cov >= 0.03) score = 1;
      if (score < 2) {
        const ansWords = ansN.split(/[,，、\s]+/).filter(w => w.length >= 3);
        if (ansWords.filter(w => aiN.includes(w)).length >= Math.ceil(ansWords.length * 0.3) && ansWords.length >= 3) score = 2;
      }
      break;
    }
    case 'calculation': {
      const expNums = (q.answer + ' ' + (q.explanation || '')).match(/[\d.]+/g) || [];
      const aiNums = aiN.match(/[\d.]+/g) || [];
      const expSet = new Set(expNums.map(n => parseFloat(n).toFixed(1)));
      const aiSet = new Set(aiNums.map(n => parseFloat(n).toFixed(1)));
      let hits = 0; for (const n of expSet) { if (aiSet.has(n)) hits++; }
      const r = hits / Math.max(1, expSet.size);
      if (r >= 0.5) score = 3; else if (r >= 0.25) score = 2; else if (r >= 0.1) score = 1;
      break;
    }
  }
  return score >= 2;
}

// ===== Main =====
async function main() {
  // Select 20 diverse questions
  const sample = [];
  const types = ['fill', 'short', 'calculation'];
  for (const t of types) {
    const qs = QUESTIONS.questions.filter(q => q.type === t);
    const n = Math.min(7, qs.length);
    for (let i = 0; i < n; i++) sample.push(qs[Math.floor(i * qs.length / n)]);
  }

  console.log('Testing ' + sample.length + ' questions through LLM RAG pipeline...\n');

  let correct = 0, total = 0;
  for (const q of sample) {
    total++;
    const context = buildContext(q.question.replace(/______/g, ''));
    const hasCtx = context && context.length > 50;
    process.stdout.write('[' + total + '/' + sample.length + '] ' + q.id + ' ' + q.type + ' ');

    if (!hasCtx) {
      console.log('NO_CONTEXT');
      continue;
    }

    try {
      const answer = await callLLM(q.question, context);
      const isCorrect = evaluateAnswer(q, answer);
      if (isCorrect) correct++;
      console.log(isCorrect ? '✅' : '❌');
    } catch(e) {
      console.log('ERROR: ' + e.message.slice(0, 60));
    }

    // Rate limit: wait 500ms between calls
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== LLM RAG Evaluation Results ===');
  console.log('Total: ' + total + ' | Correct: ' + correct + ' | Accuracy: ' + (correct/total*100).toFixed(1) + '%');
}

main().catch(e => console.error('Fatal:', e));
