/* =========================================================
   추가 공부 PDF — cited textbook / PPT pages gathered into one PDF.
   The viewer attaches their own PDFs; files are read on this device only
   (pdf.js range reads, so even the 600 MB 국소해부학 scan stays light).
   ========================================================= */
const LIBS = window.__PDFLIBS || {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
};
const BOOKS = {
  RA: {name:'국소해부학 5판', sizes:[673380709, 1653518809], rx:/국소해부/, book:true},
  GL: {name:'해부학 길라잡이', sizes:[412996132], rx:/길라잡이/},
  GR: {name:'그란트 아틀라스', sizes:[79539697, 227979484], rx:/그란트|grant/i},
  O1: {name:'골학 osteology-1', sizes:[59214669], rx:/osteology[-_ ]?1/i},
  O2: {name:'골학 osteology-2', sizes:[80078009], rx:/osteology[-_ ]?2/i},
  KO: {name:'김정태p Osteology(Lower limb)', sizes:[4954951], rx:/osteology[-_ ]?lower/i},
  K1: {name:'김정태p Lower limb I', sizes:[7937981], rx:/lower[-_ ]?limb[-_ ]?i(?![iv])/i},
  K2: {name:'김정태p Lower limb II', sizes:[14970176], rx:/lower[-_ ]?limb[-_ ]?ii(?!i)/i},
  K3: {name:'김정태p Lower limb III', sizes:[6199591], rx:/lower[-_ ]?limb[-_ ]?iii/i},
  K4: {name:'김정태p Lower limb IV', sizes:[10449247], rx:/lower[-_ ]?limb[-_ ]?iv/i},
  KT: {name:'김정태p Thoracic cage', sizes:[9398902], rx:/thoracic[-_ ]?cage/i},
  KH: {name:'김정태p Heart, Lung', sizes:[9169259], rx:/heart[-_ ,]*lung/i},
  SA: {name:'학생발표 · 상지 관절', sizes:[11735325], rx:null},
  SB: {name:'학생발표 · 팔이음뼈·자유팔뼈·근막', sizes:[7630386], rx:null},
  SC: {name:'학생발표 · 팔오금~손', sizes:[3987489], rx:null},
  SD: {name:'학생발표 · 피부신경~위팔', sizes:[11854105], rx:null}
};
const LS_OFF = 'jbmid.pdfoff';
const OFF = lsGet(LS_OFF) || {};
const LINK = {};      // book key -> File (attached, remembered, or fetched built-in)
const DOCS = {};      // book key -> pdf.js document promise
const BUILTIN = window.__BUILTIN || /*BUILTIN*/{};   // book key -> asset url uploaded with this page
const REMEMBERED = new Set();

/* attached textbooks are kept in this browser (IndexedDB) so they need picking only once per device */
const IDB = {db: null};
function idb(){
  if (!IDB.db) IDB.db = new Promise((res, rej) => {
    let rq; try { rq = indexedDB.open('jbmid-books', 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('files');
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  }).catch(e => { IDB.db = null; throw e; });
  return IDB.db;
}
async function idbReq(mode, fn){
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('files', mode); const r = fn(tx.objectStore('files')); tx.oncomplete = () => res(r && r.result); tx.onerror = tx.onabort = () => rej(tx.error); });
}
async function restoreLinks(){
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly'), st = tx.objectStore('files'), cur = st.openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { if (!LINK[c.key] && BOOKS[c.key]) { LINK[c.key] = c.value; REMEMBERED.add(c.key); } c.continue(); } };
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) {}
}
async function remember(k, f){ try { await idbReq('readwrite', st => st.put(f, k)); REMEMBERED.add(k); return true; } catch (e) { return false; } }
async function forget(k){ try { await idbReq('readwrite', st => st.delete(k)); } catch (e) {} REMEMBERED.delete(k); delete LINK[k]; delete DOCS[k]; }
function hasSrc(k){ return !!(LINK[k] || BUILTIN[k]); }
async function fileOf(k){
  if (LINK[k]) return LINK[k];
  if (BUILTIN[k]) {
    const r = await fetch(BUILTIN[k]);
    if (!r.ok) throw new Error(`내장 파일을 불러오지 못했어요 (${r.status})`);
    const b = await r.blob();
    return (LINK[k] = new File([b], BOOKS[k].name + '.pdf', {type: 'application/pdf'}));
  }
  throw new Error('파일 미연결');
}

function parseRefs(text){
  const out = [], seen = new Set();
  const push = (b, p, raw) => { const k = b + ':' + p + (raw ? 'r' : ''); if (p > 0 && !seen.has(k)) { seen.add(k); out.push({b, p, raw: !!raw}); } };
  const t = String(text || '');
  let m;
  const rxs = [
    [/국소해부(?:학)?\s*(?:5판)?\s*\(?\s*pdf\s*기준\s*\)?\s*p\.?\s*(\d+)/gi, m => push('RA', +m[1], true)],
    [/국소해부(?:학)?\s*(?:5판|pdf)?\s*p\.\s*(\d+)/g, m => push('RA', +m[1])],
    [/(?:해부학\s*)?길라잡이(?:\s*PDF)?\s*p\.\s*(\d+)/g, m => push('GL', +m[1])],
    [/골학\s*\(?\s*osteology-([12])\s*\)?\s*PDF\s*p\.\s*(\d+)/g, m => push('O' + m[1], +m[2])],
    [/(?:Grant\s*PDF|그란트)\s*p\.\s*(\d+)/g, m => push('GR', +m[1])]
  ];
  for (const [rx, fn] of rxs) { rx.lastIndex = 0; while ((m = rx.exec(t))) fn(m); }
  return out;
}
function refsOf(q){
  if (q.rf) return q.rf.map(([b, p]) => ({b, p, raw: true}));
  return parseRefs(eff(q).x);
}
function pdfPageOf(r){ return r.b === 'RA' && r.raw ? r.p : r.p + (OFF[r.b] || 0); }
function refLabel(r){ return `${BOOKS[r.b] ? BOOKS[r.b].name : r.b} ${r.b === 'RA' && !r.raw ? 'p.' + r.p : (r.b === 'RA' ? 'PDF ' + r.p : (r.b[0] === 'K' || r.b[0] === 'S' ? '슬라이드 ' + r.p : 'p.' + r.p))}`; }

function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.append(s); });
}
let libsP = null;
function libs(){
  if (!libsP) libsP = (async () => {
    if (!window.pdfjsLib) { await loadScript(LIBS.pdfjs); await loadScript(LIBS.worker); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.worker; }
    if (!window.jspdf) await loadScript(LIBS.jspdf);
  })().catch(e => { libsP = null; throw e; });
  return libsP;
}
function openDoc(key){
  if (!DOCS[key]) {
    DOCS[key] = fileOf(key).then(file => {
      const lib = window.pdfjsLib;
      class FileRange extends lib.PDFDataRangeTransport {
        requestDataRange(begin, end){ file.slice(begin, end).arrayBuffer().then(b => this.onDataRange(begin, new Uint8Array(b))); }
      }
      const range = new FileRange(file.size, null);
      return lib.getDocument({range, length: file.size, rangeChunkSize: 1 << 20, disableAutoFetch: true, disableStream: true, isEvalSupported: false}).promise;
    }).catch(e => { delete DOCS[key]; throw e; });
  }
  return DOCS[key];
}
async function renderPage(key, n, width){
  const doc = await openDoc(key);
  if (n < 1 || n > doc.numPages) throw new Error(`없는 쪽 (PDF ${n} / ${doc.numPages})`);
  const page = await doc.getPage(n);
  const v1 = page.getViewport({scale: 1});
  const vp = page.getViewport({scale: width / v1.width});
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  page.cleanup();
  return c;
}
function assignFiles(files){
  const unknown = [];
  for (const f of files) {
    let k = Object.keys(BOOKS).find(b => BOOKS[b].sizes.includes(f.size));
    if (!k) k = Object.keys(BOOKS).find(b => BOOKS[b].rx && BOOKS[b].rx.test(f.name.normalize('NFC')));
    if (k) { LINK[k] = f; delete DOCS[k]; } else unknown.push(f);
  }
  return unknown;
}
async function rememberAll(keys){
  let bad = 0;
  for (const k of keys) if (LINK[k] && !BUILTIN[k] && !(await remember(k, LINK[k]))) bad++;
  return bad;
}

/* ---- canvas text helpers for the question pages ---- */
const PW = 1240, PH = 1754, M = 80;
function wrap(ctx, text, maxW){
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch === ' ' ? '' : ch; }
      else line += ch;
    }
    lines.push(line);
  }
  return lines;
}
function newSheet(){
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'top';
  return [c, x];
}
const FONT = '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
function drawBlock(x, y, label, text, opt){
  opt = opt || {};
  const size = opt.size || 26, lh = Math.round(size * 1.55), maxY = opt.maxY || PH - M;
  if (label) { x.fillStyle = opt.color || '#2f5d50'; x.font = `700 24px ${FONT}`; x.fillText(label, M, y); y += 38; }
  x.fillStyle = '#1d1d1b'; x.font = `${opt.weight || 400} ${size}px ${FONT}`;
  const lines = wrap(x, text, PW - 2 * M);
  for (let i = 0; i < lines.length; i++) {
    if (y + lh > maxY) { x.fillText('…', M, y); y += lh; break; }
    x.fillText(lines[i], M, y); y += lh;
  }
  return y + 18;
}
function imgFromB64(b64, type){
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `data:${type};base64,${b64}`; });
}
async function questionSheet(q, idx, total, refs, notes){
  const e = eff(q);
  const [c, x] = newSheet();
  x.fillStyle = '#2f5d50'; x.fillRect(0, 0, PW, 14);
  x.font = `500 22px ${FONT}`; x.fillStyle = '#5c5b56';
  x.fillText(`추가 공부 ${idx}/${total}  ·  ${q.c} ${SUBS[q.c] || ''}  ·  ${q.s}`.slice(0, 90), M, 44);
  x.font = `700 36px ${FONT}`; x.fillStyle = '#1d1d1b'; x.fillText(q.g, M, 84);
  let y = 150;
  if (q.set === 'p') y = drawBlock(x, y, '문제', q.tx, {size: 24, maxY: 860});
  else {
    try { await loadRegion(q.c[0]); } catch (er) {}
    const b64 = window.__IMG[q.id];
    if (b64) {
      try {
        const im = await imgFromB64(b64, 'image/webp');
        const w = Math.min(PW - 2 * M, im.width), h = Math.min(im.height * w / im.width, 700);
        const ww = im.width * h / im.height;
        x.drawImage(im, M, y, ww, h); x.strokeStyle = '#dedbd2'; x.strokeRect(M, y, ww, h); y += h + 30;
      } catch (er) { y = drawBlock(x, y, '문제', e.tx || q.tx || '', {size: 22, maxY: 860}); }
    } else y = drawBlock(x, y, '문제', e.tx || q.tx || '', {size: 22, maxY: 860});
  }
  const p = P[q.id];
  y = drawBlock(x, y, '정답', e.d, {size: 26, weight: 700});
  if (p) { x.font = `400 21px ${FONT}`; x.fillStyle = '#8d8b84'; x.fillText(`내 기록: ${p.r === 1 ? '맞음' : p.r === 2 ? '모름' : '틀림'} · 틀린 횟수 ${wrongN(q.id)}${p.a && p.a !== '모름' ? ' · 내 답 ' + p.a : ''}`.slice(0, 80), M, y - 10); y += 26; }
  const memo = ((ST[q.id] && ST[q.id].note) || '').trim();
  if (memo) y = drawBlock(x, y, '📝 내 메모', memo, {size: 23, maxY: y + 260, color: '#a1532e'});
  y = drawBlock(x, y, '해설', e.x, {size: 22, maxY: PH - 300});
  const refLines = refs.length ? refs.map(r => `• ${refLabel(r)}  →  ${notes.get(r) || ''}`).join('\n') : '• 연결된 교재 쪽이 없어요 (해설에 쪽수 표기 없음)';
  drawBlock(x, Math.max(y, PH - 290), '이어지는 참고 페이지', refLines, {size: 21, maxY: PH - 40});
  return c;
}
function tocSheets(entries, title){
  const sheets = [];
  let c, x, y;
  const start = () => { [c, x] = newSheet(); x.fillStyle = '#2f5d50'; x.fillRect(0, 0, PW, 14); y = 70; };
  start();
  x.font = `700 44px ${FONT}`; x.fillStyle = '#1d1d1b'; x.fillText(title, M, y); y += 70;
  x.font = `400 22px ${FONT}`; x.fillStyle = '#5c5b56'; x.fillText(`${new Date().toLocaleDateString('ko-KR')} · ${entries.length}문제 · 인구기1 중간 JB 채점기`, M, y); y += 60;
  for (const en of entries) {
    if (y > PH - 120) { sheets.push(c); start(); }
    x.font = `500 24px ${FONT}`; x.fillStyle = '#1d1d1b';
    const t = `${en.i}. [${en.q.c}] ${en.q.g}`;
    x.fillText(t.length > 46 ? t.slice(0, 46) + '…' : t, M, y);
    x.font = `400 22px ${FONT}`; x.fillStyle = '#5c5b56';
    const pg = `${en.page}쪽 · 참고 ${en.n}쪽`; x.fillText(pg, PW - M - x.measureText(pg).width, y + 2);
    y += 42;
  }
  sheets.push(c);
  return sheets;
}

/* ---- the maker screen ---- */
function openPdfMaker(list, title){
  if (!list.length) return;
  S = null;
  $('#home').classList.add('hidden');
  $('#quiz').classList.remove('hidden');
  window.scrollTo(0, 0);
  const box = $('#quiz');
  const opts = {sheet: true, dedupe: true, width: 1240};
  let busy = false;
  const fileIn = el('input', {type:'file', accept:'application/pdf,.pdf', multiple:true, class:'hidden'});
  const status = el('div', {class:'msg'});
  const tableBox = el('div');
  fileIn.addEventListener('change', async () => {
    const unknown = assignFiles([...fileIn.files]);
    fileIn.value = '';
    pending = unknown; drawTable();
    status.className = 'msg' + (unknown.length ? ' err' : '');
    status.textContent = '이 기기에 기억하는 중…';
    const bad = await rememberAll(Object.keys(LINK).filter(k => !REMEMBERED.has(k) && !BUILTIN[k]));
    status.textContent = (unknown.length ? `알아보지 못한 파일 ${unknown.length}개: ${unknown.map(f => f.name).join(', ')} — 아래 목록에서 직접 지정해 주세요. ` : '파일을 연결했어요. ')
      + (bad ? `(${bad}개는 저장공간이 부족해 이 기기에 기억하지 못했어요 — 다음에 다시 골라야 해요)` : '다음부터는 이 기기에서 다시 고를 필요가 없어요.');
    drawTable();
  });
  let pending = [];
  const needed = () => {
    const m = {};
    list.forEach(q => refsOf(q).forEach(r => { (m[r.b] = m[r.b] || new Set()).add(pdfPageOf(r)); }));
    return m;
  };
  function drawTable(){
    const need = needed();
    const keys = Object.keys(need).sort((a, b) => Object.keys(BOOKS).indexOf(a) - Object.keys(BOOKS).indexOf(b));
    const rows = keys.map(k => {
      const f = LINK[k];
      const pv = el('div', {class:'nimgs'});
      const offRow = el('div', {class:'stepper', style:'margin-top:6px'});
      const refEx = list.map(q => refsOf(q).find(r => r.b === k && !(k === 'RA' && r.raw))).find(Boolean);
      const drawOff = () => offRow.replaceChildren(
        el('button', {class:'btn sm', onclick: () => setOff(-1)}, '−'),
        el('span', {class:'sv', text: k === 'RA' ? `책 쪽 + ${OFF[k] || 0} = PDF 쪽` : `쪽 보정 ${(OFF[k] || 0) >= 0 ? '+' : ''}${OFF[k] || 0}`}),
        el('button', {class:'btn sm', onclick: () => setOff(1)}, '+'),
        (f || BUILTIN[k]) && refEx ? el('button', {class:'btn sm ghost', onclick: preview}, `${refLabel(refEx)} 미리보기`) : null);
      function setOff(d){ OFF[k] = (OFF[k] || 0) + d; lsSet(LS_OFF, OFF); drawOff(); if (pv.childNodes.length) preview(); summary(); }
      async function preview(){
        pv.replaceChildren(el('div', {class:'note', text:'불러오는 중…'}));
        try { await libs(); const c = await renderPage(k, pdfPageOf(refEx), 700); c.style.maxWidth = '100%'; c.style.border = '1px solid var(--line)'; pv.replaceChildren(el('div', {class:'note', text:`PDF ${pdfPageOf(refEx)}쪽 — 해설이 가리키는 내용인지 확인하고, 아니면 −/+로 맞춰 주세요.`}), c); }
        catch (er) { pv.replaceChildren(el('div', {class:'msg err', text:'미리보기 실패: ' + (er.message || er)})); }
      }
      drawOff();
      const showOff = (f || BUILTIN[k]) && (k === 'RA' || k === 'GR' || k === 'GL' || k === 'O1' || k === 'O2');
      const builtin = !!BUILTIN[k];
      return el('li', {style:'flex-wrap:wrap'},
        el('span', {class:'chip ' + (f || builtin ? 'ok' : 'warn'), text: builtin ? '내장' : f ? (REMEMBERED.has(k) ? '기억됨' : '연결됨') : '미연결'}),
        el('div', {class:'t'}, el('div', null, BOOKS[k] ? BOOKS[k].name : k),
          el('small', null, `필요한 쪽 ${need[k].size}개` + (builtin ? ' · 채점기에 들어 있어 자동으로 불러와요' : f ? ` · ${f.name}` : ' · 아래 📎 버튼으로 한 번만 연결하면 돼요')),
          showOff ? offRow : null, pv),
        f && !builtin ? el('button', {class:'btn sm ghost', title:'이 기기에서 이 파일 연결 해제', onclick: async ev => { ev.stopPropagation(); await forget(k); drawTable(); }}, '해제') : null);
    });
    const assign = pending.map(f => {
      const s = el('select', null, el('option', {value:'', text:`"${f.name}"는 어떤 자료인가요?`}), Object.keys(BOOKS).map(k => el('option', {value:k, text:BOOKS[k].name})));
      s.addEventListener('change', () => { if (s.value) { LINK[s.value] = f; delete DOCS[s.value]; pending = pending.filter(x => x !== f); drawTable(); } });
      return el('div', {class:'field'}, s);
    });
    tableBox.replaceChildren(keys.length ? el('ul', {class:'panel wl'}, rows) : el('div', {class:'panel empty', text:'고른 문제들의 해설에 교재·PPT 쪽수가 없어요. 문제·해설 페이지만 만들어져요.'}), ...assign);
    summary();
  }
  const sumBox = el('div', {class:'selinfo', style:'margin:8px 0'});
  function summary(){
    const need = needed();
    let tot = 0, miss = 0;
    for (const k in need) { tot += need[k].size; if (!hasSrc(k)) miss += need[k].size; }
    sumBox.textContent = `${list.length}문제 · 참고 쪽 ${tot}개` + (miss ? ` (그중 ${miss}개는 파일 미연결 — 문제 페이지에 쪽수만 적혀요)` : '') + (opts.sheet ? ` · 문제·해설 페이지 ${list.length}장` : '');
  }
  const chk = (label, key) => {
    const b = el('span', {class:'chk' + (opts[key] ? ' on' : '')});
    return el('div', {class:'srow', onclick: () => { opts[key] = !opts[key]; b.className = 'chk' + (opts[key] ? ' on' : ''); summary(); }}, b, el('div', {class:'nm', text: label}));
  };
  const qual = el('select', null, el('option', {value:'1240', text:'보통 화질 (가벼움)'}), el('option', {value:'1700', text:'선명하게 (파일 큼)'}));
  qual.addEventListener('change', () => opts.width = +qual.value);
  const prog = el('div', {class:'note', id:'pdfProg'});
  const goBtn = el('button', {class:'btn primary', id:'pdfGo', onclick: build}, 'PDF 만들기');
  box.replaceChildren(
    el('div', {class:'qtop'}, el('button', {class:'btn sm', onclick: exitQuiz}, '← 목록'), el('div', {class:'pos', text: title})),
    el('div', {class:'panel', style:'padding:14px'},
      el('h3', {style:'margin:0 0 6px;font-size:17px', text:'📄 참고 페이지 PDF 만들기'}),
      el('div', {class:'note', style:'margin:0 0 10px', text:'문제마다 [문제·정답·해설·내 메모] 한 장 뒤에, 해설이 근거로 든 국소해부학·그란트·골학·길라잡이 쪽과 강의·발표 PPT 슬라이드를 이어 붙여 PDF 하나로 만들어요.'}),
      el('div', {class:'actions', style:'margin:0'}, el('button', {class:'btn', onclick: () => fileIn.click()}, '📎 교재 PDF 연결 (한 번만)'), fileIn),
      el('div', {class:'note', text:'강의·발표 PPT는 채점기에 들어 있어 자동으로 쓰여요. 교재(국소해부학 5판, 그란트, 골학 1·2, 길라잡이)는 이 기기에서 한 번만 골라 두면 기억해요. 교재 파일은 이 기기 안에서만 읽고 어디에도 올리지 않아요.'}),
      status),
    el('div', {style:'margin-top:10px'}, tableBox),
    el('div', {class:'panel', style:'padding:6px 0;margin-top:10px'}, chk('문제·정답·해설 페이지 넣기', 'sheet'), chk('같은 쪽은 한 번만 넣기', 'dedupe')),
    el('div', {class:'field', style:'margin-top:10px'}, el('label', {text:'화질'}), qual),
    sumBox,
    el('div', {class:'actions'}, goBtn, prog));
  drawTable();
  restoreLinks().then(() => { if (REMEMBERED.size) { status.className = 'msg'; status.textContent = `이 기기에 기억된 교재 ${REMEMBERED.size}개를 연결했어요.`; } drawTable(); });

  async function build(){
    if (busy) return; busy = true; goBtn.disabled = true;
    try {
      prog.textContent = '라이브러리 불러오는 중…';
      await libs();
      try { await document.fonts.load(`700 24px "Noto Sans KR"`); await document.fonts.load(`400 24px "Noto Sans KR"`); } catch (er) {}
      const W = opts.width;
      // plan: for each question, sheet + pages
      const used = new Map();   // "key:page" -> output page number
      const plan = [];
      const tocN = tocSheets(list.map((q, i) => ({i: i + 1, q, page: 0, n: 0})), title).length;
      let pageNo = tocN;
      for (const q of list) {
        const refs = refsOf(q);
        const items = [];
        const notes = new Map();
        const qStart = pageNo + 1;
        if (opts.sheet) pageNo++;
        for (const r of refs) {
          const pn = pdfPageOf(r), id = r.b + ':' + pn;
          if (!hasSrc(r.b)) { notes.set(r, '파일 미연결'); continue; }
          if (opts.dedupe && used.has(id)) { notes.set(r, `${used.get(id)}쪽에 이미 있음`); continue; }
          pageNo++; used.set(id, pageNo); notes.set(r, `${pageNo}쪽`);
          items.push({r, pn});
        }
        plan.push({q, refs, items, notes, start: qStart, n: items.length});
      }
      const tocEntries = plan.map((p, i) => ({i: i + 1, q: p.q, page: p.start, n: p.n}));
      const {jsPDF} = window.jspdf;
      let pdf = null;
      const add = (canvas, q) => {
        const k = 595 / canvas.width, w = canvas.width * k, h = canvas.height * k;
        const data = canvas.toDataURL('image/jpeg', q || 0.82);
        if (!pdf) pdf = new jsPDF({unit:'pt', format:[w, h], orientation: w > h ? 'l' : 'p', compress: true});
        else pdf.addPage([w, h], w > h ? 'l' : 'p');
        pdf.addImage(data, 'JPEG', 0, 0, w, h, undefined, 'FAST');
      };
      for (const c of tocSheets(tocEntries, title)) add(c, 0.9);
      let done = 0, total = plan.reduce((s, p) => s + p.items.length + (opts.sheet ? 1 : 0), 0);
      const failed = [];
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (opts.sheet) { add(await questionSheet(p.q, i + 1, plan.length, p.refs, p.notes), 0.88); done++; }
        for (const it of p.items) {
          prog.textContent = `${done + 1} / ${total}쪽 만드는 중… (${BOOKS[it.r.b].name} ${it.pn}쪽)`;
          try { add(await renderPage(it.r.b, it.pn, W)); }
          catch (er) { failed.push(`${refLabel(it.r)}: ${er.message || er}`); const [c, x] = newSheet(); drawBlock(x, 200, '이 쪽을 불러오지 못했어요', `${refLabel(it.r)} (PDF ${it.pn}쪽)\n${er.message || er}`); add(c); }
          done++;
          await new Promise(r => setTimeout(r, 0));
        }
      }
      prog.textContent = 'PDF 저장 준비 중…';
      const blob = pdf.output('blob');
      const fname = `${title.replace(/[\\/:*?"<>|]/g, ' ')} 참고자료 ${new Date().toISOString().slice(0, 10)}.pdf`;
      const mb = (blob.size / 1048576).toFixed(1);
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
      if (dl) {
        try { await dl.save({filename: fname, data: blob}); prog.textContent = `저장했어요 · ${total + tocN}쪽 · ${mb}MB` + (failed.length ? ` · 못 불러온 쪽 ${failed.length}개` : ''); }
        catch (er) { prog.textContent = er && er.code === 'declined' ? '저장을 취소했어요.' : '저장하지 못했어요: ' + (er && (er.message || er.code) || er); }
      } else {
        const url = URL.createObjectURL(blob);
        window.__lastPdf = blob;
        prog.replaceChildren(`다 만들었어요 · ${total + tocN}쪽 · ${mb}MB `, el('a', {href: url, download: fname, class:'btn sm primary', id:'pdfLink'}, 'PDF 받기'));
      }
      if (failed.length) box.append(el('div', {class:'warnbox', text:'못 불러온 쪽:\n' + failed.slice(0, 20).join('\n')}));
    } catch (er) {
      prog.textContent = '만들지 못했어요: ' + (er.message || er) + (/load https/.test(String(er.message)) ? ' (라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.)' : '');
    } finally { busy = false; goBtn.disabled = false; }
  }
}
