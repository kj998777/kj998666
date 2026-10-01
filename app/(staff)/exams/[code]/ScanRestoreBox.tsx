"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { restoreScanPdfAction } from "./digitize-actions";
import { pdfTooLarge, uploadScanRestoreDirect } from "@/lib/supabase/uploadPdf";
import { fitPdfForUpload } from "@/lib/pdf/shrinkPdf";

// 2026-09-29: 예전에 '원본으로 적용'하면서 스캔본이 지워진 시험 — 처음 올렸던 스캔 PDF만 다시 넣으면
// 디지털화를 다시 하지 않고도 그림 다시 오리기·그림 자리 직접 고치기가 된다.
// 2026-09-29 원장님 제보: 다른 시험지 PDF를 넣어 그림이 엉뚱하게 잘렸음 → 넣기 전에 고른 PDF 첫 쪽과 디지털화된 첫 문제를
// 나란히 보여 주고 "같은 시험지 맞아요"를 눌러야 넣는다. 이미 넣은 스캔본도 바꿀 수 있다(mode="replace").
type Preview = { file: File; img: string; pages: number; firstQ: string };

export default function ScanRestoreBox({ code, examId, mode = "missing" }: { code: string; examId: string; mode?: "missing" | "replace" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(mode === "missing");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onPick(f: File) {
    setMsg(null);
    setPreview(null);
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return setMsg({ ok: false, text: "PDF 파일을 골라 주세요." });
    // 2026-10-01: 50MB를 넘으면 올릴 때 자동으로 줄인다(lib/pdf/shrinkPdf.ts) — 쪽 수·크기는 그대로라 확인 화면은 원본으로 본다
    setBusy(true);
    try {
      const { loadPdfJs } = await import("./buildDigitizedPdf");
      const [pdfjs, dRes] = await Promise.all([
        loadPdfJs(),
        fetch(`/exams/${encodeURIComponent(code)}/digitized`, { credentials: "same-origin", cache: "no-store" }),
      ]);
      // 디지털화된 첫 문제(가장 앞 쪽)
      let firstQ = "";
      let firstPage = 1;
      if (dRes.ok) {
        const d = await dRes.json();
        for (const p of d.pages || []) {
          const q = (p.data?.items || []).find((it: any) => it?.type === "question");
          if (q) {
            firstPage = Number(p.page_no) || 1;
            firstQ = `${q.label ? q.label + ". " : ""}${String(q.stem || "").replace(/\$/g, "").replace(/\s+/g, " ").slice(0, 120)}`;
            break;
          }
        }
      }
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      const pg = await doc.getPage(Math.min(firstPage, doc.numPages));
      const vp0 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: 420 / vp0.width });
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      setPreview({ file: f, img: cv.toDataURL("image/jpeg", 0.8), pages: doc.numPages, firstQ });
      try {
        await doc.destroy();
      } catch {
        /* 무시 */
      }
    } catch (e: any) {
      setMsg({ ok: false, text: "PDF를 열지 못했습니다: " + (e?.message || String(e)) });
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!preview) return;
    setBusy(true);
    setMsg(null);
    try {
      const pdf = pdfTooLarge(preview.file) ? (await fitPdfForUpload(preview.file, (m) => setMsg({ ok: true, text: m }))).file : preview.file;
      const path = await uploadScanRestoreDirect(examId, pdf);
      const r: any = await restoreScanPdfAction(code, path);
      if (!r.ok) throw new Error(r.msg || "넣지 못했습니다.");
      setPreview(null);
      setMsg({
        ok: true,
        text: `스캔본(${r.pages}쪽)을 넣었습니다. 이제 디지털 시험지를 다시 만들면 그림을 이 스캔본에서 오립니다.` + (r.warning ? ` (참고: ${r.warning})` : ""),
      });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.currentTarget.value = "";
        if (f) onPick(f);
      }}
    />
  );

  if (!open) {
    return (
      <div className="text-xs text-slate-500">
        그림이 엉뚱한 시험지에서 잘려 나오면 스캔본이 다른 파일일 수 있어요 ·{" "}
        <button type="button" className="text-sky-700 hover:underline" onClick={() => setOpen(true)}>
          스캔본 바꾸기
        </button>
      </div>
    );
  }

  return (
    <div className={"rounded-lg border p-3 text-sm space-y-2 " + (mode === "missing" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
      {mode === "missing" ? (
        <p className="text-amber-900">
          이 시험은 예전에 &lsquo;원본으로 적용&rsquo;하면서 스캔본이 지워져서, 그림을 다시 오리거나 그림 자리를 고칠 수 없습니다.
          <b> 처음 디지털화할 때 올렸던 스캔 PDF</b>만 다시 넣어 주세요. 디지털화는 다시 하지 않아도 되고, 지금 원본(디지털 시험지)도 그대로입니다.
        </p>
      ) : (
        <p className="text-slate-700">
          그림을 오리는 스캔본을 바꿉니다. <b>처음 디지털화할 때 올렸던 스캔 PDF</b>를 골라 주세요(쪽수가 다르면 받지 않습니다).
        </p>
      )}
      {!preview && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary text-sm px-3 py-1" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "여는 중…" : mode === "missing" ? "스캔본 다시 올리기" : "스캔 PDF 고르기"}
          </button>
          {mode === "replace" && (
            <button type="button" className="text-slate-500 hover:underline" onClick={() => setOpen(false)}>
              닫기
            </button>
          )}
          {picker}
        </div>
      )}
      {preview && (
        <div className="space-y-2">
          <p className="font-medium text-slate-900">같은 시험지인지 확인해 주세요</p>
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr] items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.img} alt="고른 PDF 첫 쪽" className="w-56 max-w-full border border-slate-300 rounded bg-white" />
            <div className="space-y-1 text-slate-700">
              <p>
                고른 파일: <b>{preview.file.name}</b> ({preview.pages}쪽)
              </p>
              <p className="text-xs text-slate-500">디지털화된 첫 문제:</p>
              <p className="rounded bg-white border border-slate-200 px-2 py-1 text-sm">{preview.firstQ || "(문제 글을 불러오지 못했어요)"}</p>
              <p className="text-xs text-slate-500">왼쪽 쪽 그림에 이 문제가 보이면 같은 시험지입니다.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-sm px-3 py-1" disabled={busy} onClick={onConfirm}>
              {busy ? "넣는 중…" : "같은 시험지 맞아요, 넣기"}
            </button>
            <button type="button" className="btn-secondary text-sm px-3 py-1" disabled={busy} onClick={() => input.current?.click()}>
              다른 파일 고르기
            </button>
            {picker}
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? "text-emerald-700" : "text-red-600"}>{msg.text}</p>}
    </div>
  );
}
