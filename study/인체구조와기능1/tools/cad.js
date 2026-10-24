/* 카데바 땡시 — 실습노트 사진으로 만든 정거장(핀 하나 = 문항 하나) 시험 · 사진 공부
   data: cad/stations.json {weeks:[{id,name,date,src,groups:{"1":"카데바 특징"},stations:[{id,g,img,w,h,cap,note,pins:[{x,y,ko,en,acc,refs,sum,est}]}]}]}
   wrong-answer list syncs through the grader's account KV (m3d.* keys) when available */
(function(){
"use strict";
const LS_WRONG = 'm3d.cad.wrong', LS_PREF = 'm3d.cad.pref', LS_HIST = 'm3d.cad.hist';
let DATA = null, root = null, STATE = {view:'home'}, timerId = 0;
const $c = s => root.querySelector(s);
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const k in (attrs || {})){
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function kvGet(k){
  try { const m = window.__m3dKV && window.__m3dKV.mem[k]; if (m && typeof m.v === 'string') return m.v; } catch(e){}
  try { return localStorage.getItem(k); } catch(e){ return null; }
}
function kvSet(k, v){
  try { localStorage.setItem(k, v); } catch(e){}
  try { if (window.__m3dKV) window.__m3dKV.put(k, v); } catch(e){}
}
const jget = (k, d) => { try { const v = kvGet(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } };
const getWrong = () => new Set(jget(LS_WRONG, []));
const setWrong = s => kvSet(LS_WRONG, JSON.stringify([...s]));
const pref = () => {
  const ids = DATA ? DATA.weeks.map(w => w.id) : ['w1'];
  const P = Object.assign({weeks:ids, groups:[], cads:[], n:20, sec:30, order:'random', lang:'any'}, jget(LS_PREF, {}));
  if (!Array.isArray(P.cads)) P.cads = [];
  P.weeks = P.weeks.filter(w => ids.includes(w)); if (!P.weeks.length) P.weeks = ids;
  return P;
};
const savePref = p => kvSet(LS_PREF, JSON.stringify(p));

/* ---------- answer matching ---------- */
function norm(s){
  return String(s || '').toLowerCase()
    .replace(/[()\[\]{}.,·・\/\-_'"`~!?:;]/g, ' ')
    .replace(/\b(the|of|muscles?|mm?|nerves?|nn?|n)\b/g, ' ')
    .replace(/\s+/g, '');
}
function lev(a, b){   // optimal string alignment distance: a swapped pair of letters counts as one slip
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  const d = Array.from({length:a.length + 1}, (_, i) => { const r = new Array(b.length + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++){
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// 'ok' exact (after normalising), 'near' small spelling slip, '' wrong
function judge(input, pin){
  const x = norm(input); if (!x) return '';
  // also accept the names without their bracketed explanation, and a muscle's name for its tendon (not 널힘줄/aponeurosis)
  const raw = [pin.ko, pin.en, ...(pin.acc || [])];
  const more = raw.flatMap(a => { const b = String(a || '').replace(/\([^)]*\)/g, ' ').trim(); return [b, ...String(a || '').split(/[()]/).map(t => t.trim()).filter(t => t.length > 1)]; });
  let acc = [...raw, ...more].map(norm).filter(Boolean);
  acc = [...acc, ...acc.map(a => a.replace(/tendons?$/, '').replace(/(?<!널)힘줄$/, ''))].filter(a => a.length > 1);
  const x2 = x.replace(/tendons?$/, '').replace(/(?<!널)힘줄$/, '');
  if (acc.includes(x2)) return 'ok';
  if (acc.includes(x)) return 'ok';
  for (const a of acc){
    if (/^[a-z]+$/.test(a) && a.length >= 6 && lev(x, a) <= (a.length >= 14 ? 2 : 1)) return 'near';
    if (!/^[a-z]+$/.test(a) && a.length >= 4 && lev(x, a) <= 1) return 'near';
  }
  return '';
}

/* ---------- pin drawing ---------- */
// the pin sits on (x,y); its number tag is pushed toward the photo's centre so it never leaves the frame
function pinLayer(st, pins, opts){
  opts = opts || {};
  const W = st.w, H = st.h, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'cadPins'); svg.setAttribute('aria-hidden', 'true');
  const R = Math.max(W, H) / (opts.small ? 40 : 52);
  pins.forEach((p, i) => {
    if (p.box){   // masked label: the label's text was painted out of the photo; mark that box instead of a pin
      const [x0, y0, x1, y1] = [p.box[0] * W, p.box[1] * H, p.box[2] * W, p.box[3] * H], on = !(opts.dim && opts.dim(i));
      const g = document.createElementNS(svg.namespaceURI, 'g'); g.setAttribute('class', 'cadPin' + (on ? '' : ' dim'));
      const fs = Math.max(R * .9, Math.min(R * 2.2, (y1 - y0) * .7)), lab = opts.label ? opts.label(i) : i + 1;
      g.innerHTML = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${R * .4}" fill="${opts.reveal && opts.reveal(i) ? '#fff' : '#fff3f0'}" stroke="#d62828" stroke-width="${R * .3}"/>` +
        `<text x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2}" dy=".36em" text-anchor="middle" font-size="${opts.reveal && opts.reveal(i) ? Math.min(fs, (x1 - x0) * .92 / Math.max(2, String(p.ko).length)) : fs}" font-weight="700" fill="#d62828" font-family="system-ui,sans-serif">${opts.reveal && opts.reveal(i) ? esc(p.ko) : lab}</text>`;
      if (opts.onPin){ g.style.cursor = 'pointer'; g.style.pointerEvents = 'all'; g.addEventListener('click', ev => { ev.stopPropagation(); opts.onPin(i); }); }
      svg.append(g); return;
    }
    const px = p.x * W, py = p.y * H;
    let dx = W / 2 - px, dy = H / 2 - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const len = R * 4.2, tx = px + dx * len, ty = py + dy * len;
    const g = document.createElementNS(svg.namespaceURI, 'g'); g.setAttribute('class', 'cadPin' + (opts.dim && opts.dim(i) ? ' dim' : ''));
    g.innerHTML = `<line x1="${px}" y1="${py}" x2="${tx}" y2="${ty}" stroke="#fff" stroke-width="${R * .55}" stroke-linecap="round"/>` +
      `<line x1="${px}" y1="${py}" x2="${tx}" y2="${ty}" stroke="#d62828" stroke-width="${R * .28}" stroke-linecap="round"/>` +
      `<circle cx="${px}" cy="${py}" r="${R * .42}" fill="#d62828" stroke="#fff" stroke-width="${R * .18}"/>` +
      `<circle cx="${tx}" cy="${ty}" r="${R * 1.05}" fill="#d62828" stroke="#fff" stroke-width="${R * .2}"/>` +
      `<text x="${tx}" y="${ty}" dy=".36em" text-anchor="middle" font-size="${R * 1.25}" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">${opts.label ? opts.label(i) : i + 1}</text>`;
    if (opts.onPin){ g.style.cursor = 'pointer'; g.style.pointerEvents = 'all'; g.addEventListener('click', ev => { ev.stopPropagation(); opts.onPin(i); }); }
    svg.append(g);
  });
  return svg;
}
// photos live in a few JSON bundles (cad/b_<week><a|b>.json = {file: base64 jpeg}), fetched once when first needed
const BUN = {};
function bundle(b){
  if (!BUN[b]) BUN[b] = fetch('cad/' + b + '.json').then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { delete BUN[b]; throw e; });
  return BUN[b];
}
function photo(st, pins, opts){
  const box = h('div', {class:'cadPhoto', style:`aspect-ratio:${st.w}/${st.h}`});
  const img = h('img', {alt:'카데바 사진 ' + st.cap, draggable:'false'});
  if (st.b) bundle(st.b).then(d => { if (d[st.img]) img.src = 'data:image/jpeg;base64,' + d[st.img]; }, () => { box.classList.add('cadMiss'); });
  else img.src = 'cad/' + st.img;
  box.append(img, pinLayer(st, pins, opts));
  box.addEventListener('click', () => box.classList.toggle('big'));
  return box;
}

const who = st => (st.cad ? `${st.cad}번 카데바 · ${st.g}조` : `${st.g}조 카데바`);
/* ---------- pools ---------- */
function allItems(){
  const out = [];
  for (const w of DATA.weeks) for (const st of w.stations) st.pins.forEach((p, i) => out.push({key:`${st.id}#${i}`, w, st, p, i}));
  return out;
}
function groupsOf(weeks){
  const s = new Set();
  for (const w of DATA.weeks) if (weeks.includes(w.id)) for (const st of w.stations) s.add(st.g);
  return [...s].sort((a, b) => a - b);
}
function cadsOf(weeks){
  const s = new Set();
  for (const w of DATA.weeks) if (weeks.includes(w.id)) for (const st of w.stations) if (st.cad) s.add(st.cad);
  return [...s].sort((a, b) => a - b);
}
function poolFor(P, onlyWrong){
  const wrong = getWrong();
  return allItems().filter(it => P.weeks.includes(it.w.id) && (!P.cads.length || P.cads.includes(it.st.cad)) && (!onlyWrong || wrong.has(it.key)));
}
function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- 구조물 묶음 · 우선순위 ----------
   same structure across photos/cadavers = one 'structure' (key from the English name without side, tendon, brackets)
   tier from how many different cadavers show it labelled (well-dissected everywhere → likely 땡시 station) */
const LS_MAST = 'm3d.cad.mast';
const EXAM = {
  'great saphenous vein':'9/30 카땡 기출', 'common fibular nerve':'9/30 카땡 기출 — 종아리뼈머리 뒤를 도는 신경', 'extensor hallucis longus':'3조 땡시에 출제됨',
  'medial pectoral nerve':'김진우 교수님이 카땡 답으로 내심', 'falciform margin saphenous opening':'교수님 카땡 출제 예상 (두렁정맥구멍도 정답)',
  'internal intercostal':'교수님 땡시 예고 — 맨눈으로 두 근육 구분', 'external intercostal':'교수님 땡시 예고 — 맨눈으로 두 근육 구분',
  'supraspinatus':'교수님이 카땡용으로 어깨관절을 여심', 'infraspinatus':'교수님이 카땡용으로 어깨관절을 여심', 'teres minor':'교수님이 카땡용으로 어깨관절을 여심',
  'subscapularis':'교수님이 카땡용으로 어깨관절을 여심', 'long head biceps brachii':'교수님이 카땡용으로 어깨관절을 여심 (긴갈래힘줄)'};
function skey(p){
  const e = String(p.en || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(tendons?|muscles?|m|mm|the|of|left|right|lt|rt|l|r|belly|cut|reflected)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return e || 'ko:' + norm(p.ko);
}
const cadOf = it => it.st.cad ? 'c' + it.st.cad : it.w.id + 'g' + it.st.g;
// groups.json (cad/tools/groups.py): 같은 구조 합치기(한글 동의어·묶음 라벨), 해부된 카데바, 단독 핵심 이유
let GRP = null;
const keyOf = it => (GRP && GRP.keys[it.st.id] && GRP.keys[it.st.id][it.i]) || skey(it.p);
const TIERS = [null, {n:'1순위', d:'카데바 5곳 이상에서 해부됨 + 땡시 출제·예고(★)'}, {n:'단독 핵심', d:'카데바 1곳뿐이지만 중요 — 족보 단골·그 카데바의 변이·교수님 강조'}, {n:'2순위', d:'카데바 3~4곳'}, {n:'3순위', d:'카데바 2곳'}, {n:'4순위', d:'카데바 1곳 — 나머지'}];
const TN = [1, 2, 3, 4, 5];
let IDX = null;
function index(){
  if (IDX) return IDX;
  const M = new Map();
  for (const it of allItems()){
    const k = it.sk = keyOf(it);
    let s = M.get(k); if (!s){ s = {k, items:[], cads:new Set(), ko:{}, en:it.p.en, weeks:{}}; M.set(k, s); }
    s.items.push(it); s.cads.add(cadOf(it));
    const ko = String(it.p.ko).replace(/\s*\([^)]*\)\s*/g, ' ').trim(); s.ko[ko] = (s.ko[ko] || 0) + 1;
    s.weeks[it.w.id] = (s.weeks[it.w.id] || 0) + 1;
  }
  for (const s of M.values()){
    s.name = Object.entries(s.ko).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    // a single note that names this structure and says it may come up in 땡시
    // 땡시에 실제로 나왔거나 교수님이 예고한 구조 (노트 문장에서 직접 골라 둔 목록)
    s.why = EXAM[s.k] || ''; s.prof = !!s.why;
    const g = GRP && GRP.g[s.k];
    if (g) for (const c of g.cov) s.cads.add('c' + c);   // 묶음 라벨로 함께 해부된 카데바
    s.solo = (g && g.solo) || '';
    const n = s.prof ? 99 : s.cads.size;
    s.tier = n >= 5 ? 1 : n >= 3 ? 3 : n >= 2 ? 4 : s.solo ? 2 : 5;
    s.soloRank = !s.solo ? 0 : /^족보|변이/.test(s.solo) ? 2 : 1;
    s.topWeek = Object.entries(s.weeks).sort((a, b) => b[1] - a[1])[0][0];
    const by = new Map();
    for (const it of s.items){ const c = cadOf(it), sc = (it.p.box ? 0 : 2) + (it.p.est ? 0 : 1), cur = by.get(c); if (!cur || sc > cur.sc) by.set(c, {it, sc}); }
    s.reps = [...by.values()].sort((a, b) => b.sc - a.sc).map(x => x.it);
    s.refs = (s.items.find(it => it.p.refs && it.p.refs.length) || {p:{}}).p.refs || [];
    s.sum = (s.items.find(it => it.p.sum) || {p:{}}).p.sum || '';
  }
  const list = [...M.values()].sort((a, b) => a.tier - b.tier || (b.prof - a.prof) || (b.soloRank - a.soloRank) || b.cads.size - a.cads.size || b.items.length - a.items.length);
  // 합쳐진 옛 키의 익힘 기록을 대표 키로 옮김
  if (GRP){ const MM = mast(); let ch = false;
    for (const s of list){ const al = (GRP.g[s.k] || {}).al || []; for (const a of al) if (MM[a]){ MM[s.k] = (MM[s.k] || []).concat(MM[a]).slice(-4); delete MM[a]; ch = true; } }
    if (ch) kvSet(LS_MAST, JSON.stringify(MM)); }
  IDX = {M, list};
  return IDX;
}
const mast = () => jget(LS_MAST, {});
const stateOf = k => { const r = mast()[k] || []; return !r.length ? 'new' : (r.length >= 2 && r[r.length - 1] && r[r.length - 2]) ? 'ok' : r[r.length - 1] ? 'once' : 'bad'; };
function recordMast(res){
  const M = mast();
  for (const r of res){ const k = r.it.sk || keyOf(r.it); (M[k] = M[k] || []).push(r.j ? 1 : 0); M[k] = M[k].slice(-4); }
  kvSet(LS_MAST, JSON.stringify(M));
}
function fixMast(r){ const M = mast(), k = r.it.sk || keyOf(r.it); if (M[k] && M[k].length){ M[k][M[k].length - 1] = isOk(r) ? 1 : 0; kvSet(LS_MAST, JSON.stringify(M)); } }
// one question per structure, alternating photos between rounds
function oneEach(structs, ok){
  const seen = jget('m3d.cad.rot', {});
  const out = structs.map(s => { const R = s.reps.filter(it => !ok || ok(it)); if (!R.length) return null; const i = (seen[s.k] || 0) % R.length; seen[s.k] = i + 1; return Object.assign({sk:s.k}, R[i]); }).filter(Boolean);
  kvSet('m3d.cad.rot', JSON.stringify(seen));
  return out;
}
function dedup(pool){
  const by = new Map(); for (const it of shuffle(pool.slice())){ const k = it.sk || keyOf(it); if (!by.has(k)) by.set(k, it); }
  return [...by.values()];
}
// 추천 순서: 순위가 높은 구조부터, 같은 순위 안에서는 틀림 → 안 풀어 봄 → 한 번 맞힘 → 익힘 (익힘은 맨 뒤로)
function priorityPool(tiers, P, cad){
  const order = {bad:0, new:1, once:2, ok:3};
  const okIt = it => P.weeks.includes(it.w.id) && (!cad || it.st.cad === cad);
  let L = index().list.filter(s => tiers.includes(s.tier) && s.items.some(okIt));
  const notDone = L.filter(s => stateOf(s.k) !== 'ok');
  if (notDone.length) L = notDone.concat(L.filter(s => stateOf(s.k) === 'ok'));
  L = shuffle(L).sort((a, b) => (stateOf(a.k) === 'ok') - (stateOf(b.k) === 'ok') || a.tier - b.tier || order[stateOf(a.k)] - order[stateOf(b.k)] || (b.prof - a.prof) || (b.soloRank - a.soloRank));
  return oneEach(L, okIt);
}
// 카데바마다: 그 카데바에서 해부된 구조 수와 익힘 수
function cadStats(P){
  const ws = new Set(P.weeks), by = new Map();
  for (const s of index().list) for (const it of s.items){ if (!ws.has(it.w.id) || !it.st.cad) continue; if (!by.has(it.st.cad)) by.set(it.st.cad, new Map()); by.get(it.st.cad).set(s.k, s); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([c, m]) => { const S = [...m.values()]; return {c, n:S.length, ok:S.filter(s => stateOf(s.k) === 'ok').length, top:S.filter(s => s.tier <= 2).length, topOk:S.filter(s => s.tier <= 2 && stateOf(s.k) === 'ok').length}; });
}
function priorityPanel(P){
  const I = index(), ws = new Set(P.weeks), L = I.list.filter(s => s.items.some(it => ws.has(it.w.id)));
  const cnt = t => L.filter(s => s.tier === t), done = t => cnt(t).filter(s => stateOf(s.k) === 'ok').length;
  const n = P.n || 20;
  const all = L.length, allOk = L.filter(s => stateOf(s.k) === 'ok').length;
  const nextT = TN.find(t => cnt(t).length && done(t) < cnt(t).length);
  return h('div', {class:'panel cadPri'},
    h('div', {class:'cadIntroT'}, '우선순위 공부'),
    h('p', {}, '여러 카데바에서 공통으로 잘 해부된 구조일수록 땡시에 나올 가능성이 높아요. 같은 구조는 한 번에 대표 사진 하나만 나오고, 풀 때마다 다른 카데바 사진으로 바뀌어요. 두 번 연속 맞히면 “익힘”이에요.'),
    h('div', {class:'cadNext'},
      h('div', {}, h('b', {}, `전체 익힘 ${allOk} / ${all}`), h('small', {}, nextT ? ` · 지금은 ${TIERS[nextT].n} 차례 (남은 ${cnt(nextT).length - done(nextT)}개)` : ' · 모두 익혔어요')),
      h('div', {class:'cadTierBar'}, h('i', {style:`width:${all ? allOk / all * 100 : 0}%`})),
      h('button', {type:'button', class:'btn primary cadBigBtn', onclick:() => startExam(priorityPool(TN, P), Object.assign({}, P, {order:'seq', n}))}, `▶ 이어서 공부 · ${n}문항`),
      h('small', {class:'cadFoot'}, '높은 순위부터, 틀린 것 → 안 풀어 본 것 → 한 번 맞힌 것 순서로 나오고 익힌 구조는 뒤로 빠져요.')),
    h('div', {class:'cadTiers'}, TN.map(t => h('div', {class:'cadTier'},
      h('div', {}, h('b', {}, TIERS[t].n), h('small', {}, TIERS[t].d)),
      h('div', {class:'cadTierN'}, `${cnt(t).length}개 구조 · 익힘 ${done(t)}`),
      h('div', {class:'cadTierBar'}, h('i', {style:`width:${cnt(t).length ? done(t) / cnt(t).length * 100 : 0}%`})),
      h('button', {type:'button', class:'btn sm', disabled:!cnt(t).length, onclick:() => startExam(priorityPool([t], P), Object.assign({}, P, {order:'seq'}))}, `${TIERS[t].n} 땡시`)))),
    h('div', {class:'cadGo'},
      h('button', {type:'button', class:'btn', onclick:() => renderList(P)}, '구조물 목록'),
      h('button', {type:'button', class:'btn', onclick:() => renderCads(P)}, '카데바별 보기')));
}
function cadPanel(P){
  const C = cadStats(P);
  return h('div', {class:'panel cadPri'},
    h('div', {class:'cadIntroT'}, '카데바별 공부'),
    h('p', {}, '땡시는 실습한 카데바에서 나와요. 카데바를 누르면 그 카데바에서 해부된 구조를 순위대로 모아 보고, 그 카데바만 우선순위로 풀 수 있어요. (괄호 = 1순위·단독 핵심 구조)'),
    h('div', {class:'cadCadGrid'}, C.map(x => h('button', {type:'button', class:'cadCadBtn', onclick:() => renderCads(P, x.c)},
      h('b', {}, `${x.c}번`),
      h('small', {}, `익힘 ${x.ok}/${x.n} (${x.topOk}/${x.top})`),
      h('div', {class:'cadTierBar'}, h('i', {style:`width:${x.n ? x.ok / x.n * 100 : 0}%`}))))));
}
const ST_LBL = {ok:'익힘', once:'한 번 맞힘', bad:'틀림', new:'안 풀어 봄'};
function structRow(s, P){
  const st = stateOf(s.k);
  return h('button', {type:'button', class:'cadSRow ' + st, onclick:() => renderStruct(s.k, P)},
    h('span', {class:'cadSDot', title:ST_LBL[st]}),
    h('span', {class:'cadSName'}, h('b', {}, s.name), ' ', h('small', {}, s.en)),
    h('span', {class:'cadSMeta'}, `카데바 ${s.cads.size} · 사진 ${s.items.length}${s.prof ? ' · ★ ' + s.why : s.solo ? ' · ◆ ' + s.solo : ''}`));
}
function backBar(title, fn){ return h('div', {class:'cadTop'}, h('button', {type:'button', class:'btn sm', onclick:fn}, '← 땡시로'), h('span', {class:'cadNo'}, title), h('span', {})); }
function renderList(P){
  stopTimer(); STATE = {view:'list'};
  const ws = new Set(P.weeks), L = index().list.filter(s => s.items.some(it => ws.has(it.w.id)));
  root.replaceChildren(backBar('구조물 목록', () => renderHome()),
    h('p', {class:'cadFoot'}, '점 색: 초록 익힘 · 노랑 한 번 맞힘 · 빨강 틀림 · 회색 안 풀어 봄. 누르면 그 구조가 나온 모든 사진을 모아 봐요.'),
    ...TN.map(t => { const T = L.filter(s => s.tier === t); return T.length ? h('section', {class:'cadGrp'}, h('h3', {}, `${TIERS[t].n} · ${TIERS[t].d} (${T.length})`), h('div', {class:'panel cadSList'}, T.map(s => structRow(s, P)))) : null; }));
}
function renderStruct(k, P){
  stopTimer(); STATE = {view:'struct'};
  const s = index().M.get(k); if (!s) return renderList(P);
  let show = false;
  const box = h('div', {class:'cadStudy'});
  const draw = () => box.replaceChildren(...s.items.map(it => h('div', {class:'panel cadSt'},
    h('div', {class:'cadStCap'}, `${it.w.name} · ${who(it.st)}`),
    it.p.box ? photo(it.st, it.st.pins, {label:j => j === it.i ? (show ? '' : '?') : '', dim:j => j !== it.i, reveal:j => show && j === it.i}) : photo(it.st, [it.p], {label:() => show ? '✓' : '?'}),
    show ? h('p', {class:'cadNote'}, h('b', {}, it.p.ko), ' ', it.p.en, it.p.est ? ' (노트에서 추정)' : '') : null,
    show && it.st.note ? h('p', {class:'cadNote'}, it.st.note) : null)));
  const btn = h('button', {type:'button', class:'btn sm', onclick:() => { show = !show; btn.textContent = show ? '이름 가리기' : '이름 보기'; draw(); }}, '이름 보기');
  draw();
  root.replaceChildren(backBar(`${TIERS[s.tier].n} · 카데바 ${s.cads.size}곳`, () => renderList(P)),
    h('div', {class:'panel cadIntro'}, h('div', {class:'cadIntroT'}, show ? s.name : '같은 구조, 다른 카데바'),
      h('p', {}, '사진마다 같은 구조에 핀(또는 ? 칸)이 있어요. 이름을 떠올려 본 뒤 “이름 보기”로 확인하세요.'),
      s.prof ? h('p', {class:'cadEst'}, '★ ' + s.why) : null,
      s.solo ? h('p', {class:'cadEst'}, '◆ 단독 핵심 — ' + s.solo) : null,
      h('div', {class:'cadGo'}, btn, h('button', {type:'button', class:'btn sm primary', onclick:() => startExam(s.items.map(it => Object.assign({sk:k}, it)), Object.assign({}, P, {n:0, order:'random'}))}, `이 구조만 땡시 ${s.items.length}문항`)),
      s.sum ? h('details', {}, h('summary', {}, '설명·교재 쪽'), h('p', {}, s.sum), s.refs.length ? h('p', {class:'cadRef'}, s.refs.join(' · ')) : null) : null),
    box);
}
let CINFO = null, CINFO_P = null;
function loadCInfo(){ if (!CINFO_P) CINFO_P = fetch('cad/cadinfo.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => { CINFO = j; return j; }).catch(e => { CINFO_P = null; throw e; }); return CINFO_P; }
function cadInfoPanel(c){
  const d = CINFO && CINFO[c]; if (!d) return null;
  return h('div', {class:'panel cadIntro cadInfo'},
    h('div', {class:'cadIntroT'}, `${c}번 카데바 특이사항`),
    h('p', {class:'cadInfoOne'}, d.one),
    h('p', {class:'cadRef'}, '담당: ' + d.groups.map((g, i) => `${i + 1}주 ${g}조`).join(' · ')),
    d.sec.map(([t, xs]) => h('details', {open:''}, h('summary', {}, h('b', {}, t), h('small', {}, ' ' + xs.length)), h('ul', {}, xs.map(x => h('li', {class: x.startsWith('★') ? 'cadStar' : ''}, x))))));
}
function renderCads(P, start){
  stopTimer(); STATE = {view:'cads', cad:start};
  const I = index(), ws = new Set(P.weeks), by = new Map();
  for (const s of I.list) for (const it of s.items){ if (!ws.has(it.w.id) || !it.st.cad) continue; const c = it.st.cad; if (!by.has(c)) by.set(c, new Map()); by.get(c).set(s.k, s); }
  const cads = [...by.keys()].sort((a, b) => a - b);
  let cur = STATE.cad || cads.sort((a, b) => by.get(b).size - by.get(a).size)[0];
  cads.sort((a, b) => a - b);
  const body = h('div', {});
  const draw = () => {
    const S = [...by.get(cur).values()].sort((a, b) => a.tier - b.tier || b.cads.size - a.cads.size);
    const notes = []; for (const w of DATA.weeks){ if (!ws.has(w.id)) continue; for (const st of w.stations) if (st.cad === cur && w.groups[st.g] && !notes.some(n => n[1] === w.groups[st.g])) notes.push([`${w.name} · ${st.g}조`, w.groups[st.g]]); }
    const pool = allItems().filter(it => it.st.cad === cur && ws.has(it.w.id));
    body.replaceChildren(
      h('div', {class:'cadGo'},
        h('button', {type:'button', class:'btn primary', onclick:() => startExam(priorityPool(TN, P, cur), Object.assign({}, P, {order:'seq', n:P.n || 20}))}, `▶ ${cur}번 우선순위 ${Math.min(P.n || 20, S.length)}문항`),
        h('button', {type:'button', class:'btn', onclick:() => startExam(dedup(pool), Object.assign({}, P, {n:0, order:'random'}))}, `구조 전부 ${S.length}개`),
        h('button', {type:'button', class:'btn', onclick:() => renderStudy(Object.assign({}, P, {cads:[cur]}))}, '사진으로 공부'),
        h('button', {type:'button', class:'btn', onclick:() => startExam(pool, Object.assign({}, P, {n:0, order:'random'}))}, `사진 전부 ${pool.length}문항`)),
      cadInfoPanel(cur),
      notes.length ? h('details', {class:'panel cadIntro'}, h('summary', {class:'cadIntroT'}, `${cur}번 카데바 원문 노트 · 주차별 ${notes.length}개`), notes.map(n => h('p', {}, h('b', {}, n[0] + ' '), n[1]))) : null,
      h('div', {class:'panel cadSList'}, S.map(s => structRow(s, P))));
  };
  draw();
  if (!CINFO) loadCInfo().then(() => { if (STATE.view === 'cads') draw(); }, () => {});
  root.replaceChildren(backBar('카데바별 보기', () => renderHome()),
    h('p', {class:'cadFoot'}, '땡시는 실습한 카데바에서 나와요. 카데바마다 여러 주에 걸쳐 해부된 구조를 모았어요(숫자 = 라벨이 붙은 구조 수).'),
    h('div', {class:'cadChips'}, cads.map(c => h('button', {type:'button', class:'cadChip' + (c === cur ? ' on' : ''), onclick:e => { cur = c; STATE.cad = c; root.querySelectorAll('.cadChips .cadChip').forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); }}, `${c}번`, h('small', {}, by.get(c).size)))),
    body);
}

/* ---------- home ---------- */
function renderHome(){
  stopTimer();
  STATE = {view:'home'};
  const P = pref(), wrong = getWrong();
  const cs = cadsOf(P.weeks); P.cads = P.cads.filter(c => cs.includes(c));
  const pool0 = poolFor(P), pool = P.dedup === false ? pool0 : dedup(pool0), pw = poolFor(P, true);
  const chip = (on, label, fn, extra) => h('button', {type:'button', class:'cadChip' + (on ? ' on' : ''), onclick:fn, 'aria-pressed':on ? 'true' : 'false'}, label, extra ? h('small', {}, extra) : null);
  const upd = f => { f(P); savePref(P); renderHome(); };
  const hist = jget(LS_HIST, []).slice(-1)[0];
  root.replaceChildren(
    h('div', {class:'panel cadIntro'},
      h('div', {class:'cadIntroT'}, '카데바 땡시'),
      h('p', {}, '29·30기 실습노트(조별 실습리뷰) 사진에 핀을 꽂아 만든 정거장이에요. 핀이 가리키는 구조물 이름을 한글이나 영어로 쓰면 돼요.'),
      h('p', {class:'cadSrc'}, `지금 들어 있는 사진: ${DATA.weeks.map(w => `${w.name} ${new Set(w.stations.map(s => s.g)).size}개 조 · 사진 ${w.stations.length}장 · 핀 ${w.stations.reduce((a, s) => a + s.pins.length, 0)}개`).join(' / ')} `)),
    priorityPanel(P),
    cadPanel(P),
    h('div', {class:'panel cadSet'},
      h('div', {class:'cadIntroT'}, '직접 골라 풀기'),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '주차'), h('div', {class:'cadChips'}, DATA.weeks.map(w => chip(P.weeks.includes(w.id), w.name, () => upd(p => { p.weeks = p.weeks.includes(w.id) ? p.weeks.filter(x => x !== w.id) : [...p.weeks, w.id]; if (!p.weeks.length) p.weeks = [w.id]; }))))),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '카데바'), h('div', {class:'cadChips'},
        chip(!P.cads.length, '전체', () => upd(p => { p.cads = []; })),
        cs.map(c => chip(P.cads.includes(c), c + '번', () => upd(p => { p.cads = p.cads.includes(c) ? p.cads.filter(x => x !== c) : [...p.cads, c].sort((a, b) => a - b); }))))),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '문항 수'), h('div', {class:'cadChips'}, [10, 20, 30, 0].map(n => chip(P.n === n, n ? n + '개' : '전부', () => upd(p => { p.n = n; }))))),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '정거장 시간'), h('div', {class:'cadChips'}, [20, 30, 45, 60, 0].map(s => chip(P.sec === s, s ? s + '초' : '제한 없음', () => upd(p => { p.sec = s; }))))),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '겹치는 문항'), h('div', {class:'cadChips'}, chip(P.dedup !== false, '같은 구조는 한 번만', () => upd(p => { p.dedup = true; })), chip(P.dedup === false, '사진마다 전부', () => upd(p => { p.dedup = false; })))),
      h('div', {class:'cadRow'}, h('span', {class:'cadLbl'}, '순서'), h('div', {class:'cadChips'}, chip(P.order === 'random', '섞기', () => upd(p => { p.order = 'random'; })), chip(P.order === 'seq', '카데바·사진 순서', () => upd(p => { p.order = 'seq'; })))),
      h('div', {class:'cadGo'},
        h('button', {type:'button', class:'btn primary', disabled:!pool.length, onclick:() => startExam(pool, Object.assign({}, P, {bycad:true}))}, `땡시 시작 · ${P.n && P.n < pool.length ? P.n : pool.length}문항`),
        h('button', {type:'button', class:'btn', disabled:!pw.length, onclick:() => startExam(pw, Object.assign({}, P, {n:0}))}, `틀린 것만 ${pw.length}`),
        h('button', {type:'button', class:'btn', onclick:() => renderStudy(P)}, '사진으로 공부하기')),
      hist ? h('p', {class:'cadLast'}, `지난 땡시: ${hist.d} · ${hist.ok}/${hist.n} (${Math.round(hist.ok / hist.n * 100)}%)`) : null),
    h('p', {class:'cadFoot'}, '정답은 노트의 라벨(라벨 없는 같은 사진과 맞춰 핀을 옮김)과 국소해부학 5판으로 확인했어요. 노트에서 “추정”이라고 적은 구조는 해설에 표시해 두었어요. 철자가 한두 글자 틀리면 “거의 맞음”으로 맞게 쳐요.')
  );
}

/* ---------- exam ---------- */
function startExam(pool, P){
  let items = pool.slice();
  if (P.order === 'random') shuffle(items);
  else if (P.bycad) items.sort((a, b) => (a.st.cad || 99) - (b.st.cad || 99) || a.w.id.localeCompare(b.w.id));
  if (P.n && items.length > P.n) items = items.slice(0, P.n);
  [...new Set(items.map(it => it.st.b).filter(Boolean))].forEach(b => bundle(b).catch(() => {}));
  STATE = {view:'exam', items, i:0, ans:[], sec:P.sec, t0:0};
  showItem();
}
function stopTimer(){ clearInterval(timerId); timerId = 0; }
function showItem(){
  stopTimer();
  const S = STATE, it = S.items[S.i];
  const inp = h('input', {type:'text', class:'cadIn', placeholder:'구조물 이름 (한글·영어)', autocomplete:'off', autocapitalize:'off', spellcheck:'false', enterkeyhint:'next', 'aria-label':'핀이 가리키는 구조물'});
  const bar = h('i', {}), left = h('b', {class:'cadSec'}, S.sec ? S.sec + '초' : '');
  const next = () => { S.ans[S.i] = {v:inp.value.trim(), t:Math.round((Date.now() - S.t0) / 100) / 10}; S.i++; if (S.i < S.items.length) showItem(); else showResult(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); next(); } });
  root.replaceChildren(
    h('div', {class:'cadTop'},
      h('button', {type:'button', class:'btn sm', onclick:() => { if (STATE.view === 'exam') { STATE.quitAsk = !STATE.quitAsk; showQuit(); } }}, '그만하기'),
      h('span', {class:'cadNo'}, `정거장 ${S.i + 1} / ${S.items.length}`), left),
    h('div', {class:'cadQuit', hidden:true},
      h('span', {}, '지금까지 푼 것만 채점할까요?'),
      h('button', {type:'button', class:'btn sm primary', onclick:() => { S.items = S.items.slice(0, S.i); if (S.items.length) showResult(); else renderHome(); }}, '채점하기'),
      h('button', {type:'button', class:'btn sm', onclick:() => renderHome()}, '버리고 나가기')),
    h('div', {class:'cadTimer'}, bar),
    h('div', {class:'panel cadQ'},
      it.p.box ? photo(it.st, it.st.pins, {label:j => j === it.i ? '?' : '', dim:j => j !== it.i}) : photo(it.st, [it.p], {label:() => '?'}),
      h('div', {class:'cadAsk'}, h('span', {}, `${who(it.st)} · ${it.p.box ? '? 칸의 화살표·선이 가리키는 구조물은?' : '핀이 가리키는 구조물은?'}`), h('small', {}, '사진을 누르면 크게 봐요')),
      h('div', {class:'cadAnsRow'}, inp, h('button', {type:'button', class:'btn primary', onclick:next}, S.i + 1 < S.items.length ? '다음' : '끝내기'))));
  S.t0 = Date.now();
  const top = root.getBoundingClientRect().top + window.scrollY - 8;
  if (Math.abs(window.scrollY - top) > 4) window.scrollTo({top});
  setTimeout(() => { try { inp.focus({preventScroll:true}); } catch(e){} }, 30);
  if (S.sec){
    const tick = () => {
      const r = S.sec - (Date.now() - S.t0) / 1000;
      bar.style.width = Math.max(0, r / S.sec * 100) + '%'; bar.classList.toggle('low', r <= 5);
      left.textContent = Math.max(0, Math.ceil(r)) + '초';
      if (r <= 0) next();
    };
    tick(); timerId = setInterval(tick, 200);
  } else bar.style.width = '100%';
}
function showQuit(){ const q = $c('.cadQuit'); if (q) q.hidden = !STATE.quitAsk; }
function showResult(){
  stopTimer();
  const S = STATE; S.view = 'result';
  S.res = S.items.map((it, k) => ({it, a:S.ans[k] || {v:'', t:0}, j:judge((S.ans[k] || {}).v, it.p), ov:null}));
  const wrong = getWrong();
  S.res.forEach(r => { if (r.j) wrong.delete(r.it.key); else wrong.add(r.it.key); });
  setWrong(wrong);
  recordMast(S.res);
  const hist = jget(LS_HIST, []); const ok = S.res.filter(r => r.j).length;
  hist.push({d:new Date().toLocaleString('ko-KR', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}), n:S.res.length, ok});
  kvSet(LS_HIST, JSON.stringify(hist.slice(-30)));
  renderResult();
}
function isOk(r){ return r.ov != null ? r.ov : !!r.j; }
function renderResult(){
  const S = STATE, ok = S.res.filter(isOk).length, n = S.res.length;
  const list = h('div', {class:'cadRes'});
  S.res.forEach((r, k) => list.append(resCard(r, k)));
  const wrongItems = S.res.filter(r => !isOk(r)).map(r => r.it);
  root.replaceChildren(
    h('div', {class:'panel cadScore'},
      h('div', {class:'cadBig'}, `${ok}`, h('small', {}, ` / ${n}`)),
      h('div', {}, h('b', {}, `${Math.round(ok / Math.max(1, n) * 100)}%`), h('span', {}, ` · 거의 맞음 ${S.res.filter(r => r.j === 'near' && r.ov == null).length} · 빈칸 ${S.res.filter(r => !r.a.v).length}`)),
      h('div', {class:'cadGo'},
        h('button', {type:'button', class:'btn primary', disabled:!wrongItems.length, onclick:() => startExam(wrongItems, Object.assign(pref(), {n:0}))}, `틀린 ${wrongItems.length}개 다시`),
        h('button', {type:'button', class:'btn', onclick:() => renderHome()}, '처음으로'))),
    list);
  window.scrollTo({top:Math.max(0, root.getBoundingClientRect().top + window.scrollY - 70)});
}
function explain(it){
  const p = it.p, w = it.w;
  return h('div', {class:'cadExp'},
    p.est ? h('p', {class:'cadEst'}, '노트에서 “추정”으로 적은 구조예요. 시험에서 이 자리가 나오면 같은 이름으로 쓰되, 교재 그림과 다시 맞춰 보세요.') : null,
    p.sum ? h('p', {}, p.sum) : null,
    it.st.note ? h('p', {}, h('b', {}, '사진 설명 '), it.st.note) : null,
    w.groups && w.groups[it.st.g] ? h('p', {class:'cadFeat'}, h('b', {}, `${it.st.g}조 카데바 특징 `), w.groups[it.st.g]) : null,
    p.refs && p.refs.length ? h('p', {class:'cadRef'}, '교재: ' + p.refs.join(' · ')) : null,
    h('p', {class:'cadRef'}, `출처: ${w.name} · ${who(it.st)} 실습리뷰 · ${it.st.cap}`));
}
function resCard(r, k){
  const it = r.it, okNow = isOk(r);
  const card = h('div', {class:'panel cadCard ' + (okNow ? 'ok' : 'bad')});
  const flip = h('button', {type:'button', class:'btn sm', onclick:() => {
    r.ov = okNow ? false : true;
    const wrong = getWrong(); if (isOk(r)) wrong.delete(it.key); else wrong.add(it.key); setWrong(wrong); fixMast(r);
    renderResult();
  }}, okNow ? '틀린 걸로' : '맞은 걸로');
  const exp = explain(it); exp.hidden = okNow;
  card.append(
    h('div', {class:'cadCardTop'},
      h('div', {class:'cadThumb'}, it.p.box ? photo(it.st, it.st.pins, {label:j => j === it.i ? k + 1 : '', dim:j => j !== it.i, small:true}) : photo(it.st, [it.p], {label:() => k + 1, small:true})),
      h('div', {class:'cadCardTx'},
        h('div', {class:'cadMark'}, okNow ? (r.j === 'near' && r.ov == null ? '거의 맞음' : '맞음') : '틀림', h('small', {}, ` · ${k + 1}번 · ${r.a.t}초`)),
        h('div', {class:'cadAns'}, h('b', {}, it.p.ko), ' ', h('span', {}, it.p.en)),
        h('div', {class:'cadMine'}, '내 답: ', r.a.v ? r.a.v : h('i', {}, '(빈칸)')),
        h('div', {class:'cadBtns'}, flip, h('button', {type:'button', class:'btn sm', onclick:() => { exp.hidden = !exp.hidden; }}, '해설')))),
    exp);
  return card;
}

/* ---------- study ---------- */
/* ---------- 사진으로 공부하기: 큰 부위 폴더 + 검색 ----------
   주차마다 부위가 섞여 있어서(3주차 = 팔신경얼기 + 넙다리삼각 등) 사진 설명과 핀 이름의 낱말로 부위를 정함.
   그 주차에서 나올 수 있는 부위 안에서만 고르고, 비기면 그 주차의 첫 부위 */
const REGS = ['등', '상지', '하지', '가슴', '배', '골반'];
const REG_KW = {
  '등': /등|척추|뒤통수|trapez|latissim|rhomboid|erector|suboccip|thoracolumbar|spinous|vertebr|levator scapulae/gi,
  '상지': /팔|손|겨드랑|어깨|팔꿉|노신경|자신경|정중신경|노동맥|자동맥|노쪽|자쪽|빗장|세모근|두갈래근|세갈래근|부리위팔|brachi|axill|radial|ulnar|median|humer|forearm|hand|palm|cubital|deltoid|biceps|triceps|cephalic|basilic|scapul|clavic|subclavian|carp|thenar|musculocutaneous|thoracoacromial|pectoral|serratus anterior/gi,
  '하지': /샅고랑|고샅|엉덩|넙다리|다리|종아리|발|무릎|볼기|오금|정강|두렁|궁둥|샅인대|모음근|두덩정강|장딴지|가자미|복사|femor|thigh|\bleg\b|foot|pedis|plantar|knee|patell|glute|poplit|sciatic|tibia|fibula|saphenous|sartorius|gracilis|adductor|hamstring|semiten|semimem|gastrocnem|soleus|calcane|hallucis|malleol|iliopsoas|pectineus|quadriceps|vastus|rectus femoris|sural|talus|tarsal|metatars/gi,
  '가슴': /가슴|심장|심방|심실|빗살|타원오목|판막|허파|젖|갈비|세로칸|가로막신경|대동맥|대정맥|기관|식도|미주|heart|lung|pulmon|cardi|coronar|aort|intercost|thorac|pleur|pericard|phrenic|vagus|breast|mammary|\brib|costal|stern|mediastin|atri|ventric|trache|esophag|azygos/gi,
  '배': /배|복막|창자|이자|지라|콩팥|쓸개|막창자|잘록|샘창자|그물막|간(?=[\s,(]|$)|peritone|abdomin|stomach|gastr|hepat|liver|pancrea|splen|kidney|renal|colon|cecum|duoden|jejun|ileum|omentum|mesenter|gall|bile|inguinal canal|rectus abdominis|oblique|transversus abdominis|umbilic|portal/gi};
const REG_WEEK = {w1:['등'], w2:['상지', '가슴'], w3:['상지', '하지', '등'], w4:['하지'], w5:['하지', '가슴', '상지'], w6:['가슴', '배'], w7:['배']};
function regionOf(w, st){
  if (st._reg) return st._reg;
  const c = REG_WEEK[w.id] || REGS;
  if (c.length === 1) return st._reg = c[0];
  const t = (st.cap + ' ' + st.pins.map(p => `${p.ko || ''} ${p.en || ''}`).join(' ')).toLowerCase();
  let best = c[0], bs = -1;
  for (const r of c){ const n = (t.match(REG_KW[r]) || []).length; if (n > bs){ bs = n; best = r; } }
  return st._reg = best;
}
function studyCard(st, wrong, pre, hit){
  const shown = new Set(pre || []);
  const names = h('ol', {class:'cadNames'}), wrapP = h('div', {});
  const draw = () => {
    wrapP.replaceChildren(photo(st, st.pins, {reveal:i => shown.has(i), onPin:i => { shown.has(i) ? shown.delete(i) : shown.add(i); draw(); }}));
    names.replaceChildren(...st.pins.map((p, i) => h('li', {class:(wrong.has(`${st.id}#${i}`) ? 'w' : '') + (hit && hit.has(i) ? ' hit' : '')},
      h('button', {type:'button', class:'cadName' + (shown.has(i) ? ' on' : ''), onclick:() => { shown.has(i) ? shown.delete(i) : shown.add(i); draw(); }},
        shown.has(i) ? [h('b', {}, p.ko), ' ', h('span', {}, p.en), p.est ? h('small', {}, ' (추정)') : null] : h('span', {class:'cadHid'}, '눌러서 보기')))));
  };
  const card = h('div', {class:'panel cadSt'},
    h('div', {class:'cadStCap'}, st.cap),
    wrapP, names,
    h('div', {class:'cadBtns'},
      h('button', {type:'button', class:'btn sm', onclick:() => { st.pins.forEach((_, i) => shown.add(i)); draw(); }}, '모두 보기'),
      h('button', {type:'button', class:'btn sm', onclick:() => { shown.clear(); draw(); }}, '모두 가리기')),
    st.note ? h('p', {class:'cadNote'}, st.note) : null);
  draw();
  return card;
}
// 카데바 → 주차 → 조 순서로 묶어서 보여 줌
function studySecs(list, wrong, hits){
  const out = [], by = new Map();
  for (const x of list){ const k = `${x.st.cad || 0}|${x.w.id}|${x.st.g}`; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  for (const xs of by.values()){
    const {w, st} = xs[0];
    out.push(h('section', {class:'cadGrp'},
      h('h3', {}, `${st.cad ? st.cad + '번 카데바 · ' : ''}${w.name} (${st.g}조)`),
      w.groups && w.groups[st.g] && !hits ? h('p', {class:'cadFeat'}, w.groups[st.g]) : null,
      ...xs.map(x => studyCard(x.st, wrong, hits && hits.get(x.st.id), hits && hits.get(x.st.id)))));
  }
  return out;
}
let STUDY_UI = {q:'', reg:'', open:{}};
/* 조별 실습리뷰 원본(문제로 만들지 않은 사진까지): tools/rv_build.py가 쪽 그대로 다시 저장한 PDF + 쪽별 글자·부위 목록.
   자료 저장소(/_blob)에 있고, 누르면 채점기의 옆 창(📖)에서 그 쪽부터 열림 */
const RV_URL = '/_blob/6179c2318cb86b9af8eb2ca4aee94f0f';
let RV = null, RV_P = null;
function loadRV(){ if (!RV_P) RV_P = fetch(RV_URL).then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => { RV = j; return j; }).catch(e => { RV_P = null; throw e; }); return RV_P; }
const rvName = v => `${v.week ? v.week + '주차 · ' : ''}${v.cad ? v.cad + '번 카데바 · ' : ''}${v.g ? v.g + '조' : ''}`.replace(/ · $/, '') || v.title;
function rvOpen(v, n){
  if (window.__bvDoc) window.__bvDoc(v.u, '실습리뷰 · ' + rvName(v), n || 1);
  else window.open(v.u + '#page=' + (n || 1), '_blank');
}
// 한 부위 폴더 안의 실습리뷰 목록: 리뷰마다 그 부위 쪽 번호를 눌러 바로 열기
function rvList(r, P){
  if (!RV) return h('p', {class:'cadFoot'}, '실습리뷰 원본 불러오는 중…');
  const L = RV.filter(v => (!P.cads.length || P.cads.includes(v.cad)) && v.pages.some(x => x.r === r));
  if (!L.length) return null;
  return h('section', {class:'cadGrp cadRv'},
    h('h3', {}, `📄 실습리뷰 원본 — 문제로 만들지 않은 사진까지 (${L.length}개 조)`),
    h('p', {class:'cadFeat'}, '조별 실습리뷰를 쪽 그대로 보여 줘요. 사진 위 화살표·설명은 그 조 학생들이 적은 것이에요. 쪽 번호를 누르면 옆 창에서 열리고, 두 손가락으로 넘길 수 있어요.'),
    ...L.map(v => { const ps = v.pages.filter(x => x.r === r && x.img);
      return h('div', {class:'cadRvRow'},
        h('button', {type:'button', class:'btn sm', onclick:() => rvOpen(v, (ps[0] || v.pages.find(x => x.r === r)).n)}, rvName(v)),
        h('span', {class:'cadRvPs'}, ...ps.map(x => h('button', {type:'button', class:'cadRvP', title:x.t.slice(0, 120), onclick:() => rvOpen(v, x.n)}, x.n))),
        h('small', {}, `사진 있는 쪽 ${ps.length} / 전체 ${v.n}쪽`)); }));
}
// 검색어가 들어 있는 실습리뷰 쪽 (앞뒤 글자와 함께)
function rvHits(q, regs, P){
  if (!RV) return [];
  const out = [];
  for (const v of RV){
    if (P.cads.length && !P.cads.includes(v.cad)) continue;
    for (const x of v.pages){
      if (!regs.includes(x.r)) continue;
      const t = x.t.toLowerCase(), i = t.indexOf(q);
      if (i >= 0) out.push({v, x, i});
    }
  }
  return out;
}
function renderStudy(P){
  stopTimer();
  STATE = {view:'study'};
  const wrong = getWrong();
  const all = [];
  for (const c of cadsOf(P.weeks).filter(c => !P.cads.length || P.cads.includes(c))) for (const w of DATA.weeks){
    if (!P.weeks.includes(w.id)) continue;
    for (const st of w.stations) if (st.cad === c) all.push({w, st, r:regionOf(w, st)});
  }
  const byReg = r => all.filter(x => x.r === r);
  const rvN = r => RV ? RV.filter(v => (!P.cads.length || P.cads.includes(v.cad))).reduce((a, v) => a + v.pages.filter(x => x.r === r && x.img).length, 0) : 0;
  const has = r => byReg(r).length || rvN(r);
  const body = h('div', {class:'cadStudy'}), info = h('p', {class:'cadFoot'});
  const inp = h('input', {type:'search', class:'cadIn cadSearch', placeholder:'구조물 검색 — 한글·영어 (예: 정중신경, sciatic, 빗살근)', value:STUDY_UI.q, 'aria-label':'구조물 검색'});
  const chips = h('div', {class:'cadChips'});
  const drawChips = () => chips.replaceChildren(
    h('button', {type:'button', class:'cadChip' + (!STUDY_UI.reg ? ' on' : ''), onclick:() => { STUDY_UI.reg = ''; draw(); }}, '전체', h('small', {}, all.length)),
    ...REGS.filter(has).map(r => h('button', {type:'button', class:'cadChip' + (STUDY_UI.reg === r ? ' on' : ''), onclick:() => { STUDY_UI.reg = STUDY_UI.reg === r ? '' : r; if (STUDY_UI.reg) STUDY_UI.open[r] = true; draw(); }}, r, h('small', {}, byReg(r).length || '원본'))));
  let more = 40;
  const draw = () => {
    drawChips();
    const regs = REGS.filter(r => (!STUDY_UI.reg || STUDY_UI.reg === r) && has(r));
    const q = norm(STUDY_UI.q), raw = STUDY_UI.q.trim().toLowerCase();
    if (q){
      // 검색: 핀 이름(한글·영어·다른 이름)이나 사진 설명에 들어 있으면 → 맞은 핀은 미리 펼쳐 둠
      const hits = new Map(), res = [];
      for (const x of all){
        if (!regs.includes(x.r)) continue;
        const m = new Set();
        x.st.pins.forEach((p, i) => { if ([p.ko, p.en, ...(p.acc || [])].some(a => norm(a).includes(q))) m.add(i); });
        if (m.size || String(x.st.cap).toLowerCase().includes(raw)){ hits.set(x.st.id, m); res.push(x); }
      }
      const rh = rvHits(raw, regs, P);
      const np = [...hits.values()].reduce((a, m) => a + m.size, 0);
      info.textContent = res.length || rh.length ? `"${STUDY_UI.q.trim()}" — 문제 사진 ${res.length}장 · 핀 ${np}개 (맞은 이름은 펼쳐 두고 노란 표시)${rh.length ? ` · 실습리뷰 원본 ${rh.length}쪽` : ''}` : (STUDY_UI.reg ? `${STUDY_UI.reg} 폴더에는 "${STUDY_UI.q.trim()}"이(가) 없어요. 위의 '전체'를 눌러 보세요.` : `"${STUDY_UI.q.trim()}"와 맞는 핀이 없어요. 글자를 줄이거나 한글/영어로 바꿔 보세요.`);
      const parts = [];
      if (rh.length) parts.push(h('section', {class:'cadGrp cadRv'}, h('h3', {}, `📄 실습리뷰 원본에서 찾은 쪽 ${rh.length}개`),
        ...rh.slice(0, 60).map(({v, x, i}) => h('button', {type:'button', class:'cadRvHit', onclick:() => rvOpen(v, x.n)},
          h('b', {}, `${rvName(v)} · ${x.n}쪽`), h('span', {}, '…' + x.t.slice(Math.max(0, i - 30), i), h('mark', {}, x.t.slice(i, i + raw.length)), x.t.slice(i + raw.length, i + raw.length + 50) + '…'))),
        rh.length > 60 ? h('p', {class:'cadFoot'}, `${rh.length - 60}쪽 더 있어요. 검색어를 더 길게 써 보세요.`) : null));
      for (const r of regs){
        const xs = res.filter(x => x.r === r); if (!xs.length) continue;
        parts.push(h('h2', {class:'cadRegH'}, `${r} · ${xs.length}장`), ...studySecs(xs.slice(0, more), wrong, hits));
        if (xs.length > more) parts.push(h('button', {type:'button', class:'btn sm', onclick:() => { more += 40; draw(); }}, `${r} 결과 더 보기 (${xs.length - more}장 더)`));
      }
      body.replaceChildren(...parts);
      return;
    }
    info.textContent = '폴더를 누르면 그 부위 사진이 열려요. 번호를 누르면 이름이 보이고, 빨간 번호는 지난 땡시에서 틀린 핀이에요. 폴더 맨 아래에는 문제로 만들지 않은 사진까지 담긴 조별 실습리뷰 원본이 있어요.';
    body.replaceChildren(...regs.map(r => {
      const xs = byReg(r), n = new Set(xs.flatMap(x => x.st.pins.map(p => norm(p.ko)))).size, rn = rvN(r);
      const d = h('details', {class:'panel cadFold'},
        h('summary', {}, h('span', {class:'cadFoldN'}, '📁 ' + r), h('small', {}, (xs.length ? `문제 사진 ${xs.length}장 · 구조물 약 ${n}개 · 카데바 ${new Set(xs.map(x => x.st.cad)).size}구` : '문제 사진 없음') + (rn ? ` · 실습리뷰 원본 사진 쪽 ${rn}` : ''))));
      const fill = () => { if (!d.dataset.done){ d.dataset.done = 1; const rl = rvList(r, P); d.append(h('div', {class:'cadFoldB'}, ...studySecs(xs, wrong), rl)); } };
      if (STUDY_UI.open[r] || STUDY_UI.reg === r){ d.open = true; fill(); }
      d.addEventListener('toggle', () => { STUDY_UI.open[r] = d.open; if (d.open) fill(); });
      return d;
    }));
  };
  let tm = 0;
  inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { STUDY_UI.q = inp.value; more = 40; draw(); }, 220); });
  root.replaceChildren(
    h('div', {class:'cadTop'}, h('button', {type:'button', class:'btn sm', onclick:() => renderHome()}, '← 땡시로'), h('span', {class:'cadNo'}, P.cads.length ? `사진으로 공부하기 · ${P.cads.join('·')}번 카데바` : '사진으로 공부하기'), h('span', {})),
    h('div', {class:'panel cadSBar'}, inp, chips), info, body);
  draw();
  if (!RV) loadRV().then(() => { if (STATE.view === 'study' && root.contains(body)) draw(); }, () => {});
}

/* ---------- style ---------- */
const CSS = `
#cadView{display:grid;gap:12px}
.cadIntro{padding:14px 16px}.cadIntroT{font-weight:700;font-size:16px}
.cadIntro p{margin:6px 0 0;color:var(--ink2);font-size:13.5px}.cadIntro .cadSrc{color:var(--ink3);font-size:12.5px}
.cadSet{padding:12px 14px;display:grid;gap:10px}
.cadRow{display:grid;grid-template-columns:84px 1fr;gap:8px;align-items:start}
.cadLbl{font-size:13px;color:var(--ink2);padding-top:6px}
.cadChips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.cadChip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:13.5px;color:var(--ink2)}
.cadChip.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:500}
.cadChip small{margin-left:4px;opacity:.8}
.cadGo{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.cadLast{margin:0;color:var(--ink3);font-size:12.5px}
.cadFoot{color:var(--ink3);font-size:12.5px;margin:0}
.cadTop{display:flex;align-items:center;justify-content:space-between;gap:10px}
.cadNo{font-weight:500;font-variant-numeric:tabular-nums}
.cadSec{font-variant-numeric:tabular-nums;min-width:44px;text-align:right}
.cadQuit{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--warn-soft);border-radius:10px;padding:8px 12px;font-size:13.5px}
.cadTimer{height:6px;border-radius:3px;background:var(--surface2);overflow:hidden}
.cadTimer i{display:block;height:100%;width:100%;background:var(--accent);transition:width .2s linear}
.cadTimer i.low{background:var(--bad)}
.cadQ{padding:10px;display:grid;gap:10px}
.cadPhoto{position:relative;width:100%;max-height:62vh;margin:0 auto;background:#111;border-radius:8px;overflow:hidden;cursor:zoom-in}
.cadPhoto img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-select:none}
.cadPhoto svg.cadPins{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.cadPhoto.big{max-height:none;cursor:zoom-out}
.cadPhoto.cadMiss::after{content:'사진을 불러오지 못했어요';position:absolute;inset:0;display:grid;place-items:center;color:#ccc;font-size:13px}
.cadPin.dim{opacity:.45}
.cadAsk{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;font-size:14px}
.cadAsk small{color:var(--ink3)}
.cadAnsRow{display:flex;gap:8px}
.cadIn{flex:1;min-width:0;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:10px 12px;font-size:16px}
.cadIn:focus{outline:2px solid var(--accent);outline-offset:1px}
.cadScore{padding:14px 16px;display:grid;gap:6px}
.cadBig{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}.cadBig small{font-size:16px;color:var(--ink3);font-weight:500}
.cadScore span{color:var(--ink2);font-size:13.5px}
.cadRes{display:grid;gap:8px}
.cadCard{padding:10px;border-left:4px solid var(--line)}
.cadCard.ok{border-left-color:var(--ok)}.cadCard.bad{border-left-color:var(--bad)}
.cadCardTop{display:grid;grid-template-columns:132px 1fr;gap:12px;align-items:start}
.cadThumb .cadPhoto{max-height:200px}
.cadCardTx{min-width:0;display:grid;gap:3px}
.cadMark{font-weight:700}.cadCard.ok .cadMark{color:var(--ok)}.cadCard.bad .cadMark{color:var(--bad)}
.cadMark small{color:var(--ink3);font-weight:400}
.cadAns b{font-size:15px}.cadAns span{color:var(--ink2);font-size:13.5px}
.cadMine{font-size:13.5px;color:var(--ink2);overflow-wrap:anywhere}.cadMine i{color:var(--ink3)}
.cadBtns{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.cadExp{margin-top:10px;border-top:1px solid var(--line);padding-top:8px;display:grid;gap:6px;font-size:13.5px}
.cadExp p{margin:0}.cadExp .cadRef{color:var(--ink3);font-size:12.5px}
.cadEst{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:6px 10px}
.cadFeat{color:var(--ink2);font-size:13px;margin:0}
.cadPri{padding:14px 16px;display:grid;gap:10px}.cadPri p{margin:0;color:var(--ink2);font-size:13.5px}
.cadTiers{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.cadTier{border:1px solid var(--line);border-radius:10px;padding:9px 10px;display:grid;gap:5px;background:var(--bg)}
.cadTier b{font-size:14px;margin-right:6px}.cadTier small{color:var(--ink3);font-size:12px;display:block}
.cadTierN{font-size:12.5px;color:var(--ink2);font-variant-numeric:tabular-nums}
.cadTierBar{height:5px;border-radius:3px;background:var(--surface2);overflow:hidden}.cadTierBar i{display:block;height:100%;background:var(--ok)}
.cadSet .cadIntroT{font-weight:700;font-size:15px}
.cadNext{border:1px solid var(--accent);background:var(--accent-soft);border-radius:12px;padding:12px;display:grid;gap:8px}
.cadNext small{color:var(--ink2);font-size:12.5px}
.cadBigBtn{font-size:16px;padding:12px 16px}
.cadCadGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.cadCadBtn{border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:9px 10px;display:grid;gap:4px;text-align:left}
.cadCadBtn b{font-size:15px}.cadCadBtn small{color:var(--ink3);font-size:11.5px;font-variant-numeric:tabular-nums}
.cadCadBtn:hover{border-color:var(--accent)}
.cadSList{display:grid;padding:4px 0}
.cadSRow{display:grid;grid-template-columns:12px 1fr auto;gap:10px;align-items:center;text-align:left;border:0;background:transparent;padding:8px 12px;border-bottom:1px solid var(--line)}
.cadSRow:last-child{border-bottom:0}
.cadSDot{width:10px;height:10px;border-radius:50%;background:var(--ink3);opacity:.5}
.cadSRow.ok .cadSDot{background:var(--ok);opacity:1}.cadSRow.once .cadSDot{background:var(--warn);opacity:1}.cadSRow.bad .cadSDot{background:var(--bad);opacity:1}
.cadSName{min-width:0;overflow-wrap:anywhere}.cadSName small{color:var(--ink3)}
.cadSMeta{color:var(--ink3);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
@media (max-width:520px){.cadSRow{grid-template-columns:12px 1fr}.cadSMeta{grid-column:2}}
.cadStudy{display:grid;gap:16px}
.cadGrp{display:grid;gap:8px}.cadGrp h3{margin:0;font-size:15px}
.cadSt{padding:10px;display:grid;gap:8px}
.cadStCap{font-weight:500;font-size:14px}
.cadNames{margin:0;padding-left:22px;display:grid;gap:4px;font-size:14px}
.cadNames li.w::marker{color:var(--bad);font-weight:700}
.cadName{border:1px dashed var(--line);background:var(--surface2);border-radius:8px;padding:3px 10px;text-align:left}
.cadName.on{border-style:solid;background:var(--surface)}
.cadName span{color:var(--ink2);font-size:13px}.cadHid{color:var(--ink3)!important}
.cadNote{margin:0;color:var(--ink2);font-size:13px}
.cadSBar{padding:10px 12px;display:grid;gap:8px;position:sticky;top:0;z-index:4}
.cadSearch{width:100%}
.cadFold{padding:0;overflow:hidden}
.cadFold>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:12px 14px}
.cadFold>summary::-webkit-details-marker{display:none}
.cadFold>summary::after{content:'▶';margin-left:auto;color:var(--ink3);font-size:12px;transition:transform .15s}
.cadFold[open]>summary::after{transform:rotate(90deg)}
.cadFoldN{font-weight:700;font-size:16px}.cadFold>summary small{color:var(--ink3);font-size:12.5px}
.cadFoldB{display:grid;gap:16px;padding:4px 12px 14px;border-top:1px solid var(--line)}
.cadRegH{margin:6px 0 0;font-size:16px}
.cadRv{border-top:1px dashed var(--line);padding-top:12px}
.cadRvRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:6px 0;border-bottom:1px solid var(--line)}
.cadRvRow small{color:var(--ink3);font-size:12px}
.cadRvPs{display:flex;flex-wrap:wrap;gap:4px}
.cadRvP{border:1px solid var(--line);background:var(--surface);border-radius:6px;min-width:30px;padding:2px 6px;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--ink2)}
.cadRvP:hover{border-color:var(--accent);color:var(--accent)}
.cadRvHit{display:grid;gap:2px;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 10px;font-size:13.5px}
.cadRvHit span{color:var(--ink2);font-size:13px;overflow-wrap:anywhere}.cadRvHit mark{background:var(--warn-soft);color:inherit}
.cadNames li.hit .cadName{background:var(--warn-soft);border-color:var(--warn)}
.cadInfo details{border-top:1px solid var(--line);padding:6px 0}.cadInfo summary{cursor:pointer}.cadInfo ul{margin:4px 0 0;padding-left:18px;display:grid;gap:3px}.cadInfo li{font-size:13.5px;line-height:1.5}.cadInfoOne{font-weight:600}.cadStar{color:var(--warn)}
@media (max-width:520px){.cadRow{grid-template-columns:1fr}.cadLbl{padding-top:0}.cadCardTop{grid-template-columns:96px 1fr}}
`;
async function open(el){
  root = el;
  if (!document.getElementById('cadCss')){ const s = document.createElement('style'); s.id = 'cadCss'; s.textContent = CSS; document.head.append(s); }
  if (STATE.view === 'exam'){ showItem(); return; }            // back from another tab: the station restarts its clock
  if (['result', 'study', 'list', 'struct', 'cads'].includes(STATE.view)) return;
  if (!DATA){
    root.replaceChildren(h('div', {class:'panel cadIntro'}, '사진 불러오는 중…'));
    try { [DATA, GRP] = await Promise.all([fetch('cad/stations.json').then(r => { if (!r.ok) throw 0; return r.json(); }), fetch('cad/groups.json').then(r => r.ok ? r.json() : null).catch(() => null)]); IDX = null; }
    catch(e){ root.replaceChildren(h('div', {class:'panel cadIntro'}, '땡시 사진을 불러오지 못했어요. 새로고침해 보세요.')); return; }
  }
  renderHome();
}
window.__cadOpen = open;
window.__cadLeave = () => stopTimer();
window.__cadJudge = judge;
})();
