"use client";

// 문제 글 고치기(2026-09-30 원장님 요청). 디지털화 때 숫자·글자를 잘못 옮겨 적은 문항을
//  ① 직접 고치거나 ② 그 문항"만" AI에게 다시 읽혀(확대 그림으로) 결과를 보고 덮어쓴다.
// 글만 바뀌고 그림 자리는 그대로. 저장한 뒤 "디지털 시험지를 원본으로 적용"을 다시 눌러야 원본 PDF에 반영된다.
// AI가 읽을 그림은 스캔본(/original-pdf?scan=1)을 이 브라우저에서 그려 만든다 — 스캔본이 없으면 직접 고치기만 된다.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MathToolbar } from "@/app/_components/MathTools";
import { changedFields, changedNumbers, cleanItemText, FIELD_LABEL, textOf, type ItemText } from "@/lib/digitize/itemEdit";
import { saveDigitizedItem } from "./digitize-actions";

type Box = { x0: number; y0: number; x1: number; y1: number };
export type Entry = { pageNo: number; itemIndex: number; item: any };

const pct = (v: number) => `${v / 10}%`;
const CIRC = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

export default function ItemTextFixPanel({ code, onSaved }: { code: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState(-1);
  // 2026-09-30: 디지털화 의심 문항(숫자가 처음 읽은 요약·풀이와 어긋남) — "페이지:순서" → 이유
  const [suspects, setSuspects] = useState<Record<string, { score: number; reasons: string[] }>>({});
  const docRef = useRef<any>(null);

  async function openPanel() {
    setOpen(true);
    if (entries.length) return;
    setLoading(true);
    setErr("");
    try {
      const dRes = await fetch(`/exams/${encodeURIComponent(code)}/digitized`, { credentials: "same-origin", cache: "no-store" });
      if (!dRes.ok) throw new Error("디지털화 결과를 불러오지 못했습니다.");
      const d = await dRes.json();
      const list: Entry[] = [];
      for (const p of d.pages || []) {
        (p.data?.items || []).forEach((it: any, i: number) => {
          if (it?.type === "question") list.push({ pageNo: p.page_no, itemIndex: i, item: it });
        });
      }
      setEntries(list);
      let sus: Record<string, { score: number; reasons: string[] }> = {};
      try {
        const sRes = await fetch(`/exams/${encodeURIComponent(code)}/digitize-suspects`, { credentials: "same-origin", cache: "no-store" });
        const sj = sRes.ok ? await sRes.json() : null;
        sus = sj?.suspects ?? {};
      } catch {
        /* 의심 표시는 없어도 고치기는 됨 */
      }
      setSuspects(sus);
      // 가장 의심스러운 문항부터, 없으면 AI가 흐리다고 남긴 문항, 없으면 첫 문항
      const byScore = list
        .map((e, i) => ({ i, s: sus[`${e.pageNo}:${e.itemIndex}`]?.score ?? 0 }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      const firstUnsure = list.findIndex((e) => String(e.item.unsure || "").trim());
      setSel(byScore.length ? byScore[0].i : firstUnsure >= 0 ? firstUnsure : list.length ? 0 : -1);
      // 스캔본(없어도 직접 고치기는 됨)
      try {
        const pRes = await fetch(`/exams/${encodeURIComponent(code)}/original-pdf?scan=1`, { credentials: "same-origin", cache: "no-store" });
        if (!pRes.ok) {
          let m = "스캔본 PDF를 불러오지 못했습니다.";
          try {
            const j = await pRes.json();
            if (j?.msg) m = j.msg;
          } catch {
            /* 무시 */
          }
          throw new Error(m);
        }
        const { loadPdfJs } = await import("./buildDigitizedPdf");
        const pdfjs = await loadPdfJs();
        docRef.current = await pdfjs.getDocument({ data: new Uint8Array(await pRes.arrayBuffer()) }).promise;
      } catch (e: any) {
        setScanErr((e?.message || String(e)) + " — 직접 고치기만 할 수 있어요(AI로 다시 읽기는 스캔본이 있어야 합니다).");
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary text-sm px-2 py-1" onClick={openPanel}>
        문제 글 고치기(숫자·글자)
      </button>
    );
  }

  return (
    <div className="w-full border border-slate-200 rounded-lg p-3 space-y-3 bg-white">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">문제 글 고치기</h3>
        <button className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      <p className="text-xs text-slate-500">
        숫자·글자를 잘못 옮겨 적은 문항을 고릅니다. <b>직접 고치거나</b>, <b>&ldquo;AI로 이 문제만 다시 읽기&rdquo;</b>로 그 문항만 확대해서 다시
        읽힌 뒤 바뀐 곳을 보고 덮어쓸 수 있어요. 다른 문항과 그림 자리는 그대로입니다. 다 고친 뒤{" "}
        <b>&ldquo;디지털 시험지를 원본으로 적용&rdquo;</b>을 다시 눌러야 원본 PDF에 반영됩니다.
      </p>
      {loading && <p className="text-sm text-slate-500">불러오는 중…</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {scanErr && <p className="text-xs text-amber-700">{scanErr}</p>}
      {!loading && !err && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {entries.map((e, i) => {
              const unsure = !!String(e.item.unsure || "").trim();
              const sus = suspects[`${e.pageNo}:${e.itemIndex}`];
              const strong = !!sus && sus.score >= 3;
              return (
                <button
                  key={i}
                  title={sus ? `의심: ${sus.reasons.join(" / ")}` : unsure ? `AI가 확실히 못 읽었다고 한 곳: ${e.item.unsure}` : `${e.pageNo}쪽`}
                  className={
                    "rounded border px-2 py-1 text-xs " +
                    (i === sel
                      ? "border-slate-900 bg-slate-900 text-white"
                      : strong
                        ? "border-red-400 bg-red-50 text-red-800"
                        : unsure || sus
                          ? "border-amber-400 bg-amber-50 text-amber-900"
                          : "border-slate-300 bg-white")
                  }
                  onClick={() => setSel(i)}
                >
                  {e.item.label || "?"}번{e.item.edited ? " ✓" : strong ? " !" : unsure || sus ? " ?" : ""}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            빨간 칸(!) = 숫자가 처음 AI가 읽은 문제 요약·풀이와 어긋나는 문항 · 노란 칸(?) = AI가 &ldquo;흐려서 확실히 못 읽었다&rdquo;고 남긴 문항 · ✓ = 고친 문항
          </p>
          {sel >= 0 && entries[sel] && (
            <ItemEditor
              key={`${entries[sel].pageNo}-${entries[sel].itemIndex}`}
              code={code}
              doc={docRef.current}
              entry={entries[sel]}
              reasons={suspects[`${entries[sel].pageNo}:${entries[sel].itemIndex}`]?.reasons}
              onSaved={(item) => {
                setEntries((list) => list.map((e, i) => (i === sel ? { ...e, item } : e)));
                // 고친 문항은 의심 표시를 내린다(다음에 열 때 새 글로 다시 살핌)
                setSuspects((m) => {
                  const k = `${entries[sel].pageNo}:${entries[sel].itemIndex}`;
                  if (!m[k]) return m;
                  const n = { ...m };
                  delete n[k];
                  return n;
                });
                onSaved?.();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 문항 하나 편집
// ---------------------------------------------------------------------

type Draft = { label: string; points: string; stem: string; box_title: string; box_lines: string; choices: string[]; unsure: string };

function toDraft(t: ItemText): Draft {
  return {
    label: t.label,
    points: t.points == null ? "" : String(t.points),
    stem: t.stem,
    box_title: t.box_title,
    box_lines: t.box_lines.join("\n"),
    choices: [...t.choices],
    unsure: t.unsure,
  };
}
function fromDraft(d: Draft) {
  return { label: d.label, points: d.points, stem: d.stem, box_title: d.box_title, box_lines: d.box_lines, choices: d.choices, unsure: d.unsure };
}

/** 스캔본 쪽을 그림으로(긴 변 기준 크기) */
async function renderPage(doc: any, pageNo: number, width: number): Promise<HTMLCanvasElement> {
  const pg = await doc.getPage(pageNo);
  const v1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: width / v1.width });
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv;
}

/** 캔버스의 한 부분(1000칸 좌표)을 긴 변 long px 로 맞춘 JPEG base64 */
function cropJpeg(cv: HTMLCanvasElement, b: Box, long: number): string {
  const sx = (b.x0 / 1000) * cv.width;
  const sy = (b.y0 / 1000) * cv.height;
  const sw = Math.max(2, ((b.x1 - b.x0) / 1000) * cv.width);
  const sh = Math.max(2, ((b.y1 - b.y0) / 1000) * cv.height);
  const k = long / Math.max(sw, sh);
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(sw * k));
  c.height = Math.max(2, Math.round(sh * k));
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cv, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88).split(",")[1];
}

export function ItemEditor({
  code,
  doc,
  entry,
  onSaved,
  savedNote = "저장했습니다. 다 고친 뒤 '디지털 시험지를 원본으로 적용'을 다시 누르세요.",
  reasons,
}: {
  /** 디지털화 점검에서 찾은 의심 이유(lib/digitize/suspect.ts) */
  reasons?: string[];
  code: string;
  doc: any;
  entry: Entry;
  onSaved: (item: any) => void;
  /** 저장한 뒤 보여 줄 안내(쓰는 화면마다 다음 할 일이 달라서) */
  savedNote?: string;
}) {
  // 비교 기준은 저장된 글을 같은 규칙으로 다듬은 것(끝 공백 같은 차이로 "고침"이 켜지지 않게)
  const saved = useMemo(() => {
    const t = textOf(entry.item);
    const c = cleanItemText(t);
    return c.ok ? c.text : t;
  }, [entry.item]);
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [imgUrl, setImgUrl] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const [drag, setDrag] = useState<Box | null>(null);
  const [hint, setHint] = useState("");
  const [ai, setAi] = useState<{ text: ItemText; changes: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState("");
  const [pending, start] = useTransition();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const stemRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const cleaned = cleanItemText(fromDraft(draft));
  const draftText = cleaned.ok ? cleaned.text : null;
  const dirty = !draftText || JSON.stringify(draftText) !== JSON.stringify(saved);

  // 스캔본 쪽 그림(화면용)
  useEffect(() => {
    let alive = true;
    if (!doc) return;
    renderPage(doc, entry.pageNo, 1200)
      .then((cv) => alive && setImgUrl(cv.toDataURL("image/jpeg", 0.85)))
      .catch((e) => alive && setMsg({ ok: false, text: "쪽을 그리지 못했습니다: " + (e?.message || e) }));
    return () => {
      alive = false;
    };
  }, [doc, entry.pageNo]);

  // 디지털 시험지 모양 미리보기(조금 늦게)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { renderDgItemPreview } = await import("./buildDigitizedPdf");
        const it = { ...entry.item, ...(draftText ?? {}), type: "question" };
        const html = await renderDgItemPreview(it);
        if (alive) setPreview(html);
      } catch {
        /* 미리보기 실패는 무시 */
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draftText), entry.item]);

  function toK(ev: React.PointerEvent) {
    const r = (areaRef.current as HTMLDivElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((ev.clientX - r.left) / r.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((ev.clientY - r.top) / r.height) * 1000)),
    };
  }
  function onDown(ev: React.PointerEvent) {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    startPt.current = toK(ev);
    setDrag(null);
  }
  function onMove(ev: React.PointerEvent) {
    if (!startPt.current) return;
    const p = toK(ev);
    const s = startPt.current;
    setDrag({ x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) });
  }
  function onUp() {
    const b = drag;
    startPt.current = null;
    setDrag(null);
    if (!b || b.x1 - b.x0 < 20 || b.y1 - b.y0 < 15) return;
    setBox({ x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });
  }

  async function askAi() {
    if (!doc) return;
    setAiBusy(true);
    setMsg(null);
    setAi(null);
    try {
      // 확대할 곳의 크기에 맞춰 선명하게 다시 그린다(스캔 해상도보다 크게는 의미가 적고 휴대폰 메모리도 있어 폭 3200px까지)
      const frac = box ? Math.max(0.05, (box.x1 - box.x0) / 1000) : 0.52;
      const width = Math.min(3200, Math.max(1600, Math.round(1568 / frac)));
      const cv = await renderPage(doc, entry.pageNo, width);
      const page = cropJpeg(cv, { x0: 0, y0: 0, x1: 1000, y1: 1000 }, 1500);
      const zooms = box
        ? [cropJpeg(cv, { x0: Math.max(0, box.x0 - 8), y0: Math.max(0, box.y0 - 8), x1: Math.min(1000, box.x1 + 8), y1: Math.min(1000, box.y1 + 8) }, 1568)]
        : [cropJpeg(cv, { x0: 0, y0: 0, x1: 520, y1: 1000 }, 1568), cropJpeg(cv, { x0: 480, y0: 0, x1: 1000, y1: 1000 }, 1568)];
      const res = await fetch(`/exams/${encodeURIComponent(code)}/digitize-item`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNo: entry.pageNo, itemIndex: entry.itemIndex, page, zooms, zoom: box ? "box" : "halves", hint }),
      });
      let j: any = null;
      try {
        j = await res.json();
      } catch {
        j = { ok: false, msg: res.status === 504 ? "시간이 너무 오래 걸려 멈췄습니다. 문항 자리를 네모로 좁게 지정하고 다시 눌러 주세요." : `HTTP ${res.status}` };
      }
      if (!j?.ok) throw new Error(j?.msg || "AI가 다시 읽지 못했습니다.");
      setAi({ text: j.text, changes: j.changes || "" });
      setDraft(toDraft(j.text));
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setAiBusy(false);
    }
  }

  function save(source: "manual" | "ai" | "revert") {
    start(async () => {
      setMsg(null);
      const r: any = await saveDigitizedItem(code, entry.pageNo, entry.itemIndex, source === "revert" ? null : fromDraft(draft), source).catch((e: any) => ({
        ok: false,
        msg: String(e?.message || e),
      }));
      if (!r.ok) return setMsg({ ok: false, text: r.msg || "저장하지 못했습니다." });
      onSaved(r.item);
      setAi(null);
      if (source === "revert") setDraft(toDraft(textOf(r.item)));
      setMsg({ ok: true, text: savedNote });
    });
  }

  const aiChanges = ai ? changedFields(saved, ai.text) : [];
  const fromAi = !!ai && !!draftText && JSON.stringify(draftText) === JSON.stringify(ai.text);
  const setField = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* 원본(스캔본) */}
      <div className="space-y-1 min-w-0">
        <p className="text-xs text-slate-500">
          {entry.item.label || "?"}번 · 스캔본 {entry.pageNo}쪽
          {doc ? " — 문항 자리를 네모로 끌어 그리면 AI가 그 부분을 크게 보고 읽어요(안 그리면 쪽의 왼쪽·오른쪽 절반을 크게 봅니다)." : ""}
        </p>
        {doc ? (
          <div
            ref={areaRef}
            className="relative border border-slate-300 select-none"
            style={{ touchAction: "none", cursor: "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl} alt={`스캔본 ${entry.pageNo}쪽`} className="block w-full pointer-events-none" draggable={false} />
            ) : (
              <div className="h-96 flex items-center justify-center text-sm text-slate-400">쪽을 그리는 중…</div>
            )}
            {box && (
              <div
                className="absolute border-[3px] border-sky-500 bg-sky-200/10 pointer-events-none"
                style={{ left: pct(box.x0), top: pct(box.y0), width: pct(box.x1 - box.x0), height: pct(box.y1 - box.y0) }}
              >
                <span className="absolute -top-5 left-0 rounded bg-sky-600 px-1 text-[11px] text-white">AI가 크게 볼 곳</span>
              </div>
            )}
            {drag && (
              <div
                className="absolute border-[3px] border-sky-500 bg-sky-200/20 pointer-events-none"
                style={{ left: pct(drag.x0), top: pct(drag.y0), width: pct(drag.x1 - drag.x0), height: pct(drag.y1 - drag.y0) }}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400 border border-dashed border-slate-300 rounded p-6 text-center">스캔본이 없어 원본을 보여 드릴 수 없습니다.</p>
        )}
        {box && (
          <button className="text-xs text-slate-500 hover:underline" onClick={() => setBox(null)}>
            네모 지우기
          </button>
        )}
      </div>

      {/* 고치기 */}
      <div className="space-y-2 text-sm min-w-0">
        {!!reasons?.length && (
          <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-800">
            <b>숫자 확인 필요</b> — 처음 AI가 읽은 문제 요약·풀이와 다릅니다(어느 쪽이 맞는지 원본으로 확인):
            <ul className="list-disc pl-4">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
                {String(entry.item.unsure || "").trim() && (
          <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900">AI 메모(확실히 못 읽은 곳): {entry.item.unsure}</p>
        )}
        {entry.item.edited && (
          <p className="text-xs text-emerald-700">
            {entry.item.edited === "ai" ? "AI로 다시 읽어 고친 문항" : "직접 고친 문항"}
            {entry.item.edited_at ? ` · ${new Date(entry.item.edited_at).toLocaleString("ko-KR")}` : ""}
          </p>
        )}
        <div className="flex gap-2">
          <label className="w-24">
            <span className="text-xs text-slate-500">번호</span>
            <input className="input py-1" value={draft.label} onChange={(e) => setField("label")(e.target.value)} />
          </label>
          <label className="w-24">
            <span className="text-xs text-slate-500">배점</span>
            <input className="input py-1" inputMode="decimal" value={draft.points} placeholder="없음" onChange={(e) => setField("points")(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-slate-500">문제 글(수식은 $…$ · 줄바꿈 그대로)</span>
          <textarea ref={stemRef} className="input font-mono text-xs leading-5" rows={7} value={draft.stem} onChange={(e) => setField("stem")(e.target.value)} />
        </label>
        <MathToolbar target={stemRef} value={draft.stem} onChange={setField("stem")} />
        <details open={!!(draft.box_title || draft.box_lines)}>
          <summary className="text-xs text-slate-500 cursor-pointer">&lt;보기&gt;·조건 상자</summary>
          <div className="space-y-1 mt-1">
            <input className="input py-1" value={draft.box_title} placeholder="상자 제목(예: <보기>)" onChange={(e) => setField("box_title")(e.target.value)} />
            <textarea ref={boxRef} className="input font-mono text-xs leading-5" rows={3} value={draft.box_lines} placeholder="한 줄에 한 항목" onChange={(e) => setField("box_lines")(e.target.value)} />
            <MathToolbar target={boxRef} value={draft.box_lines} onChange={setField("box_lines")} />
          </div>
        </details>
        <div className="space-y-1">
          <span className="text-xs text-slate-500">선택지(객관식만 · ①~⑤ 기호 없이)</span>
          {draft.choices.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="w-5 text-center">{CIRC[i]}</span>
              <input
                className="input py-1 font-mono text-xs"
                value={c}
                onChange={(e) => setDraft((d) => ({ ...d, choices: d.choices.map((x, k) => (k === i ? e.target.value : x)) }))}
              />
              <button className="px-1 text-slate-400 hover:text-red-600" aria-label="선택지 빼기" onClick={() => setDraft((d) => ({ ...d, choices: d.choices.filter((_, k) => k !== i) }))}>
                ×
              </button>
            </div>
          ))}
          {draft.choices.length < 8 && (
            <button className="text-xs text-slate-500 hover:underline" onClick={() => setDraft((d) => ({ ...d, choices: [...d.choices, ""] }))}>
              + 선택지 추가
            </button>
          )}
        </div>

        {preview && (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 overflow-x-auto">
            <p className="text-xs text-slate-400 mb-1">미리보기 — 디지털 시험지에 이렇게 들어갑니다(그림은 자리만)</p>
            <div className="bg-white p-2 inline-block" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        )}

        <div className="rounded border border-sky-200 bg-sky-50 p-2 space-y-2">
          <div className="text-xs text-sky-900 font-medium">AI로 이 문제만 다시 읽기</div>
          <input
            className="input py-1 text-xs"
            value={hint}
            maxLength={300}
            placeholder="틀린 곳 메모(선택) — 예: 둘째 줄 분모 3이 8로 되어 있음"
            onChange={(e) => setHint(e.target.value)}
          />
          <button className="btn-secondary py-1 px-3 text-sm" disabled={!doc || aiBusy || pending} onClick={askAi}>
            {aiBusy ? "AI가 읽는 중…(10~40초)" : "AI로 이 문제만 다시 읽기"}
          </button>
          {!doc && <p className="text-xs text-slate-500">스캔본이 있어야 쓸 수 있어요.</p>}
          {ai && (
            <div className="space-y-1 text-xs">
              {ai.changes && <p className="text-sky-900">AI: {ai.changes}</p>}
              {aiChanges.length === 0 ? (
                <p className="text-slate-600">AI도 지금과 똑같이 읽었습니다.</p>
              ) : (
                <ul className="space-y-1">
                  {aiChanges.map((c) => {
                    const nums = changedNumbers(c.before, c.after);
                    return (
                      <li key={c.key} className="rounded bg-white border border-sky-100 p-1.5">
                        <b>{FIELD_LABEL[c.key]}</b>
                        {(nums.removed.length > 0 || nums.added.length > 0) && (
                          <span className="ml-2 text-slate-600">
                            숫자 {nums.removed.length ? <span className="line-through text-red-600">{nums.removed.join(", ")}</span> : "—"} →{" "}
                            {nums.added.length ? <span className="text-emerald-700 font-semibold">{nums.added.join(", ")}</span> : "—"}
                          </span>
                        )}
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <pre className="whitespace-pre-wrap break-words bg-red-50 text-red-900 rounded px-1">{c.before || "(없음)"}</pre>
                          <pre className="whitespace-pre-wrap break-words bg-emerald-50 text-emerald-900 rounded px-1">{c.after || "(없음)"}</pre>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-slate-500">위 칸들에 AI 결과를 넣어 두었습니다. 더 고칠 곳이 있으면 고친 뒤 저장하세요.</p>
            </div>
          )}
        </div>

        {!cleaned.ok && <p className="text-xs text-red-600">{cleaned.msg}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary py-1 px-3" disabled={!dirty || !cleaned.ok || pending || aiBusy} onClick={() => save(fromAi ? "ai" : "manual")}>
            {pending ? "저장하는 중…" : fromAi ? "AI 결과로 덮어쓰기" : "저장"}
          </button>
          {dirty && (
            <button
              className="text-xs text-slate-500 hover:underline"
              onClick={() => {
                setDraft(toDraft(saved));
                setAi(null);
              }}
            >
              {ai ? "AI 결과 버리기" : "고친 것 취소"}
            </button>
          )}
          {entry.item.orig && !dirty && (
            <button className="text-xs text-slate-500 hover:underline" disabled={pending} onClick={() => save("revert")}>
              AI가 처음 읽은 글로 되돌리기
            </button>
          )}
        </div>
        {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
      </div>
    </div>
  );
}
