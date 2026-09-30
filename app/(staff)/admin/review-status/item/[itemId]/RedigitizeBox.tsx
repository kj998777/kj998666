"use client";

// 관리자 검토 문항 화면의 "이 문제 다시 디지털화"(2026-09-30 원장님 요청).
// 시험 화면의 "문제 글 고치기"(ItemTextFixPanel)와 같은 편집기를 이 문항 하나에 대해 바로 연다 —
// 직접 고치기 / 이 문제만 AI로 다시 읽기(스캔본 확대) / AI가 처음 읽은 글로 되돌리기.
// 고친 뒤 "원본 PDF에 반영"을 누르면 디지털 시험지를 다시 조판해 원본으로 적용한다(시험 화면의 "원본으로 적용"과 같음).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemEditor, type Entry } from "@/app/(staff)/exams/[code]/ItemTextFixPanel";
import { applyDigitizedPdfAsOriginal } from "@/app/(staff)/exams/[code]/digitize-actions";
import { uploadPdfDirect } from "@/lib/supabase/uploadPdf";

export default function RedigitizeBox({
  code,
  examId,
  examName,
  pageNo,
  itemIndex,
  applied,
}: {
  code: string;
  examId: string;
  examName: string;
  pageNo: number;
  itemIndex: number;
  /** 지금 원본 PDF가 디지털 시험지로 바뀐 상태인가(그렇다면 위 문제 그림도 디지털 시험지에서 오린 것) */
  applied: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [dirtySaved, setDirtySaved] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const docRef = useRef<any>(null);

  async function openBox() {
    setOpen(true);
    if (entry) return;
    setLoading(true);
    setErr("");
    try {
      const dRes = await fetch(`/exams/${encodeURIComponent(code)}/digitized`, { credentials: "same-origin", cache: "no-store" });
      if (!dRes.ok) throw new Error("디지털화 결과를 불러오지 못했습니다.");
      const d = await dRes.json();
      const page = (d.pages || []).find((p: any) => p.page_no === pageNo);
      const item = page?.data?.items?.[itemIndex];
      if (!item || item.type !== "question") throw new Error("디지털화된 문항을 찾지 못했습니다. 새로고침해 주세요.");
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
        const { loadPdfJs } = await import("@/app/(staff)/exams/[code]/buildDigitizedPdf");
        const pdfjs = await loadPdfJs();
        docRef.current = await pdfjs.getDocument({ data: new Uint8Array(await pRes.arrayBuffer()) }).promise;
      } catch (e: any) {
        setScanErr((e?.message || String(e)) + " — 직접 고치기만 할 수 있어요. 시험 화면의 디지털화 칸에서 스캔본을 다시 올리면 AI로 다시 읽기도 됩니다.");
      }
      setEntry({ pageNo, itemIndex, item });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function applyNow() {
    setApplyBusy(true);
    setApplyMsg({ ok: true, text: "디지털 시험지를 다시 만드는 중…" });
    try {
      const { buildDigitizedPdf } = await import("@/app/(staff)/exams/[code]/buildDigitizedPdf");
      const built = await buildDigitizedPdf(code, examName, (m) => setApplyMsg({ ok: true, text: m }));
      setApplyMsg({ ok: true, text: "새 원본 PDF를 올리는 중…" });
      await uploadPdfDirect(examId, new Blob([built.bytes as any], { type: "application/pdf" }));
      setApplyMsg({ ok: true, text: "정리하는 중…" });
      const r = await applyDigitizedPdfAsOriginal(code, built.locations);
      if (!r.ok) throw new Error(r.msg ?? "적용하지 못했습니다.");
      setDirtySaved(false);
      setApplyMsg({ ok: true, text: `원본 PDF에 반영했습니다(${built.pages}쪽 · 문항 ${built.items}개). 위 문제 그림도 새 원본으로 바뀝니다.` });
      router.refresh();
    } catch (e: any) {
      setApplyMsg({ ok: false, text: "실패: " + (e?.message || String(e)) });
    } finally {
      setApplyBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <b>디지털 시험지의 이 문제</b>
          <span className="text-slate-500">
            {" "}
            — 숫자·글자를 잘못 옮겨 적었으면 직접 고치거나 이 문제만 AI로 다시 읽을 수 있어요
            {applied ? "(지금 원본 PDF가 디지털 시험지라 위 문제 그림에도 보입니다)" : ""}.
          </span>
        </div>
        <button className="btn-secondary text-sm px-3 py-1" onClick={openBox}>
          이 문제 다시 디지털화
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">이 문제 다시 디지털화</h2>
        <button className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      <p className="text-xs text-slate-500">
        스캔본에서 문항 자리를 네모로 그리고 <b>&ldquo;AI로 이 문제만 다시 읽기&rdquo;</b>를 누르면, 바뀐 곳을 보여 드린 뒤 덮어쓸 수 있어요. 직접 고쳐도
        됩니다. {applied ? (
          <>
            저장한 뒤 <b>&ldquo;원본 PDF에 반영&rdquo;</b>을 눌러야 원본 시험지(과외선생님 화면·기출 다운로드)에 들어갑니다.
          </>
        ) : (
          <>이 시험은 원본이 아직 스캔본이라, 고친 글은 나중에 &ldquo;디지털 시험지를 원본으로 적용&rdquo;할 때 들어갑니다.</>
        )} 정답·해설은 아래
        &ldquo;정답·해설 직접 등록&rdquo;에서 따로 저장합니다.
      </p>
      {loading && <p className="text-sm text-slate-500">불러오는 중…</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {scanErr && <p className="text-xs text-amber-700">{scanErr}</p>}
      {entry && (
        <ItemEditor
          code={code}
          doc={docRef.current}
          entry={entry}
          onSaved={(item) => {
            setEntry((e) => (e ? { ...e, item } : e));
            setDirtySaved(true);
            setApplyMsg(null);
          }}
        />
      )}
      {(dirtySaved || applyMsg) && (
        <div
          className={
            "flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm " +
            (applyMsg && !applyMsg.ok ? "border-red-200 bg-red-50 text-red-800" : dirtySaved ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800")
          }
        >
          {dirtySaved && !applyBusy && !applied && (
            <span>
              저장했습니다. 이 시험은 아직 원본을 디지털 시험지로 바꾸지 않아서, 시험 화면에서 &ldquo;디지털 시험지를 원본으로 적용&rdquo;할 때 고친 글이
              들어갑니다.
            </span>
          )}
          {dirtySaved && !applyBusy && applied && <span>고친 글은 아직 원본 PDF에 반영되지 않았어요.</span>}
          {dirtySaved && applied && (
            <button className="btn-primary text-sm px-2 py-1" disabled={applyBusy} onClick={applyNow}>
              {applyBusy ? "반영하는 중…" : "원본 PDF에 반영"}
            </button>
          )}
          {applyMsg && <span>{applyMsg.text}</span>}
        </div>
      )}
    </div>
  );
}
