"use client";

// 그림 자리 직접 고치기(2026-09-29 원장님 요청). 디지털 시험지에서 자동 보정(lib/digitize/figureRefine.ts)으로도 그림이
// 제대로 안 잘린 곳을, 원본(스캔본) 쪽 위에서 마우스·손가락으로 네모를 그려 직접 지정한다.
//  - 파란 점선: AI가 준 자리 · 주황: 자동 보정 뒤 실제로 오려질 자리 · 초록: 직접 지정한 자리(자동 보정 안 함)
//  - 저장하면 digitized_pages의 그 문항 figures가 바뀐다(saveDigitizedFigures). 반영하려면 "원본으로 적용"을 다시 누른다.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { canvasGray, refineFigureBox, type Box } from "@/lib/digitize/figureRefine";
import { saveDigitizedFigures } from "./digitize-actions";

type Fig = Box & { where?: "stem" | "end"; manual?: boolean; ai?: Box };
type Entry = { pageNo: number; itemIndex: number; label: string; figures: Fig[] };

const pct = (v: number) => `${v / 10}%`;

export default function FigureFixPanel({ code, onSaved }: { code: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState<number>(-1);
  const docRef = useRef<any>(null);

  async function openPanel() {
    setOpen(true);
    if (docRef.current) return;
    setLoading(true);
    setErr("");
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`/exams/${encodeURIComponent(code)}/digitized`, { credentials: "same-origin", cache: "no-store" }),
        fetch(`/exams/${encodeURIComponent(code)}/original-pdf?scan=1`, { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!dRes.ok) throw new Error("디지털화 결과를 불러오지 못했습니다.");
      if (!pRes.ok) {
        let m = "원본(스캔본) PDF를 불러오지 못했습니다.";
        try {
          const j = await pRes.json();
          if (j?.msg) m = j.msg;
        } catch {
          /* 무시 */
        }
        throw new Error(m);
      }
      const d = await dRes.json();
      const list: Entry[] = [];
      for (const p of d.pages || []) {
        (p.data?.items || []).forEach((it: any, i: number) => {
          if (it?.type === "question") list.push({ pageNo: p.page_no, itemIndex: i, label: String(it.label || "?"), figures: (it.figures || []) as Fig[] });
        });
      }
      setEntries(list);
      const { loadPdfJs } = await import("./buildDigitizedPdf"); // 무거운 조판 코드는 열 때만 불러옴
      const pdfjs = await loadPdfJs();
      docRef.current = await pdfjs.getDocument({ data: new Uint8Array(await pRes.arrayBuffer()) }).promise;
      const firstFig = list.findIndex((e) => e.figures.length);
      setSel(firstFig >= 0 ? firstFig : list.length ? 0 : -1);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary text-sm px-2 py-1" onClick={openPanel}>
        그림 자리 직접 고치기
      </button>
    );
  }

  const withFig = entries.map((e, i) => ({ e, i })).filter((x) => x.e.figures.length);
  const withoutFig = entries.map((e, i) => ({ e, i })).filter((x) => !x.e.figures.length);

  return (
    <div className="w-full border border-slate-200 rounded-lg p-3 space-y-3 bg-white">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">그림 자리 직접 고치기</h3>
        <button className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      <p className="text-xs text-slate-500">
        문항을 고르고, 원본 쪽 위에서 <b>그림이 있는 곳을 네모로 끌어 그리세요</b>. 파란 점선은 AI가 준 자리, 주황은 자동 보정 뒤 실제로
        오려질 자리, 초록은 직접 지정한 자리입니다. 저장한 뒤 <b>&ldquo;디지털 시험지를 원본으로 적용&rdquo;</b>을 다시 눌러야 반영됩니다.
      </p>
      {loading && <p className="text-sm text-slate-500">원본 쪽을 불러오는 중…</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!loading && !err && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {withFig.map(({ e, i }) => (
              <button
                key={i}
                className={"rounded border px-2 py-1 text-xs " + (i === sel ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}
                onClick={() => setSel(i)}
              >
                {e.label}번{e.figures.some((f) => f.manual) ? " ✓" : ""}
              </button>
            ))}
            {withoutFig.length > 0 && (
              <select
                className="input py-1 text-xs w-auto"
                value={withoutFig.some((x) => x.i === sel) ? String(sel) : ""}
                onChange={(ev) => ev.target.value && setSel(Number(ev.target.value))}
              >
                <option value="">그림 없는 문항에 그림 넣기…</option>
                {withoutFig.map(({ e, i }) => (
                  <option key={i} value={i}>
                    {e.label}번 ({e.pageNo}쪽)
                  </option>
                ))}
              </select>
            )}
          </div>
          {sel >= 0 && entries[sel] && docRef.current && (
            <FigureEditor
              key={`${entries[sel].pageNo}-${entries[sel].itemIndex}`}
              code={code}
              doc={docRef.current}
              entry={entries[sel]}
              onSaved={(figs) => {
                setEntries((list) => list.map((e, i) => (i === sel ? { ...e, figures: figs } : e)));
                onSaved?.();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function FigureEditor({ code, doc, entry, onSaved }: { code: string; doc: any; entry: Entry; onSaved: (f: Fig[]) => void }) {
  const [pageCv, setPageCv] = useState<HTMLCanvasElement | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [draft, setDraft] = useState<Fig[]>(entry.figures.map((f) => ({ ...f })));
  const [active, setActive] = useState(entry.figures.length ? 0 : -1); // -1 = 새 그림 추가
  const [drag, setDrag] = useState<Box | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry.figures);

  // 원본 쪽을 그림으로
  useEffect(() => {
    let alive = true;
    (async () => {
      const pg = await doc.getPage(entry.pageNo);
      const v1 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: Math.min(3, Math.max(1.2, 1400 / v1.width)) });
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!alive) return;
      setPageCv(cv);
      setImgUrl(cv.toDataURL("image/jpeg", 0.85));
    })().catch((e) => setMsg("쪽을 그리지 못했습니다: " + (e?.message || e)));
    return () => {
      alive = false;
    };
  }, [doc, entry.pageNo]);

  // 자동 보정이 실제로 오릴 자리(직접 지정한 그림은 그대로)
  const gray = useMemo(() => (pageCv ? canvasGray(pageCv) : null), [pageCv]);
  const effective = useMemo(
    () =>
      draft.map((f, j) =>
        f.manual || !gray ? (f as Box) : refineFigureBox(gray.gray, gray.w, gray.h, f, draft.filter((_, k) => k !== j)).box
      ),
    [draft, gray]
  );

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
    if (!b || b.x1 - b.x0 < 8 || b.y1 - b.y0 < 8) return;
    const box = { x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) };
    setMsg("");
    if (active < 0 || active >= draft.length) {
      setDraft((d) => [...d, { ...box, where: "stem", manual: true }]);
      setActive(draft.length);
    } else {
      setDraft((d) =>
        d.map((f, j) => (j === active ? { ...f, ...box, manual: true, ai: f.ai ?? (f.manual ? undefined : { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 }) } : f))
      );
    }
  }

  function cropUrl(b: Box): string {
    if (!pageCv) return "";
    const x0 = Math.floor((b.x0 / 1000) * pageCv.width);
    const y0 = Math.floor((b.y0 / 1000) * pageCv.height);
    const w = Math.max(2, Math.ceil(((b.x1 - b.x0) / 1000) * pageCv.width));
    const h = Math.max(2, Math.ceil(((b.y1 - b.y0) / 1000) * pageCv.height));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    (c.getContext("2d") as CanvasRenderingContext2D).drawImage(pageCv, x0, y0, w, h, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.85);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        <p className="text-xs text-slate-500 mb-1">
          {entry.label}번 · 원본 {entry.pageNo}쪽 —{" "}
          {active >= 0 && active < draft.length ? `그림 ${active + 1}의 자리를 새로 그리세요` : "새 그림 자리를 그리세요"}
        </p>
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
            <img src={imgUrl} alt={`원본 ${entry.pageNo}쪽`} className="block w-full pointer-events-none" draggable={false} />
          ) : (
            <div className="h-96 flex items-center justify-center text-sm text-slate-400">쪽을 그리는 중…</div>
          )}
          {draft.map((f, j) => (
            <div key={j} className="pointer-events-none">
              {!f.manual && (
                <div className="absolute border-2 border-dashed border-sky-500" style={{ left: pct(f.x0), top: pct(f.y0), width: pct(f.x1 - f.x0), height: pct(f.y1 - f.y0) }} />
              )}
              {effective[j] && (
                <div
                  className={"absolute border-[3px] " + (f.manual ? "border-emerald-500" : "border-orange-500") + (j === active ? " bg-yellow-200/20" : "")}
                  style={{ left: pct(effective[j].x0), top: pct(effective[j].y0), width: pct(effective[j].x1 - effective[j].x0), height: pct(effective[j].y1 - effective[j].y0) }}
                >
                  <span className={"absolute -top-5 left-0 rounded px-1 text-[11px] text-white " + (f.manual ? "bg-emerald-600" : "bg-orange-500")}>그림 {j + 1}</span>
                </div>
              )}
            </div>
          ))}
          {drag && (
            <div className="absolute border-[3px] border-emerald-500 bg-emerald-200/20 pointer-events-none" style={{ left: pct(drag.x0), top: pct(drag.y0), width: pct(drag.x1 - drag.x0), height: pct(drag.y1 - drag.y0) }} />
          )}
        </div>
      </div>
      <div className="space-y-3 text-sm">
        {draft.map((f, j) => (
          <div key={j} className={"rounded border p-2 space-y-2 " + (j === active ? "border-slate-900" : "border-slate-200")}>
            <div className="flex items-center justify-between">
              <b>그림 {j + 1}</b>
              <span className={"text-xs " + (f.manual ? "text-emerald-700" : "text-orange-600")}>{f.manual ? "직접 지정" : "자동"}</span>
            </div>
            {pageCv && effective[j] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cropUrl(effective[j])} alt={`그림 ${j + 1} 미리보기`} className="max-h-40 mx-auto border border-slate-200" />
            )}
            <select
              className="input py-1 text-xs"
              value={f.where === "end" ? "end" : "stem"}
              onChange={(ev) => setDraft((d) => d.map((x, k) => (k === j ? { ...x, where: ev.target.value as "stem" | "end" } : x)))}
            >
              <option value="stem">문제 글 다음(선택지 앞)</option>
              <option value="end">선택지 뒤</option>
            </select>
            <div className="flex flex-wrap gap-2 text-xs">
              <button className="btn-secondary py-1 px-2 text-xs" onClick={() => setActive(j)}>
                자리 다시 그리기
              </button>
              {f.manual && f.ai && (
                <button
                  className="text-slate-500 hover:underline"
                  onClick={() => setDraft((d) => d.map((x, k) => (k === j ? { ...(x.ai as Box), where: x.where } : x)))}
                >
                  자동으로 되돌리기
                </button>
              )}
              <button
                className="text-red-600 hover:underline"
                onClick={() => {
                  setDraft((d) => d.filter((_, k) => k !== j));
                  setActive(-1);
                }}
              >
                이 그림 빼기
              </button>
            </div>
          </div>
        ))}
        <button className={"btn-secondary py-1 px-2 text-xs " + (active < 0 ? "ring-2 ring-slate-900" : "")} onClick={() => setActive(-1)}>
          + 그림 추가(쪽 위에 네모를 그리세요)
        </button>
        <div className="flex items-center gap-2">
          <button
            className="btn-primary py-1 px-3"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                setMsg("");
                const r = await saveDigitizedFigures(code, entry.pageNo, entry.itemIndex, draft).catch((e: any) => ({ ok: false, msg: String(e?.message || e) }));
                if (!r.ok) {
                  setMsg((r as any).msg || "저장하지 못했습니다.");
                  return;
                }
                onSaved(draft.map((f) => ({ ...f })));
                setMsg("저장했습니다. 다 고친 뒤 '디지털 시험지를 원본으로 적용'을 다시 누르세요.");
              })
            }
          >
            {pending ? "저장하는 중…" : "저장"}
          </button>
          {dirty && (
            <button className="text-xs text-slate-500 hover:underline" onClick={() => setDraft(entry.figures.map((f) => ({ ...f })))}>
              고친 것 취소
            </button>
          )}
        </div>
        {msg && <p className={"text-xs " + (msg.startsWith("저장했습니다") ? "text-emerald-700" : "text-red-600")}>{msg}</p>}
      </div>
    </div>
  );
}
