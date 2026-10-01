"use client";

import ContentKindBadge from "@/app/(tutor)/tutor/store/ContentKindBadge";
import { useState } from "react";
import type { BankDetail } from "@/lib/bank/load";

// 맞춤 시험지 PDF 만들기(브라우저에서). 문항 자세히는 /items, 그림을 오릴 쪽은 /page/[문항]에서 받는다(시험지 전체는 받지 않음).
export default function WsBuilder({ id, defaultTitle }: { id: string; defaultTitle: string }) {
  const [title, setTitle] = useState(defaultTitle);
  const [subtitle, setSubtitle] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [cover, setCover] = useState(true); // 2026-10-01: 앞뒤 표지(메딕수학 표지 + 뒤 로고)
  const [perCol, setPerCol] = useState<2 | 3>(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function items(): Promise<BankDetail[]> {
    const r = await fetch(`/tutor/worksheet/${id}/items`, { credentials: "same-origin", cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.msg || "문항을 불러오지 못했습니다.");
    return j.items as BankDetail[];
  }

  async function build(kind: "sheet" | "answer") {
    setBusy(true);
    setMsg("");
    try {
      const list = await items();
      const mod = await import("@/app/(staff)/bank/buildWorksheet");
      const { downloadBytes } = await import("@/app/(staff)/exams/[code]/results/buildReportPdf");
      const opts = {
        title: title.trim() || "맞춤 시험지",
        subtitle: subtitle.trim(),
        showSource,
        perCol,
        pdfUrlOf: (it: BankDetail) => `/tutor/worksheet/${id}/page/${it.id}`,
        cover: cover ? ("worksheet" as const) : undefined,
      };
      const safe = opts.title.replace(/[\\/:*?"<>|\s]+/g, "_");
      if (kind === "sheet") {
        const r = await mod.buildWorksheetPdf(list, opts, setMsg);
        downloadBytes(r.bytes, `${safe}.pdf`);
        setMsg(
          `시험지 ${r.pages}쪽을 받았습니다.` +
            (r.textFallback.length ? ` 원래 시험지에서 자리를 못 찾은 ${r.textFallback.length}문항은 옮겨 적은 글로 넣었어요 — 그림이 빠졌을 수 있습니다.` : "")
        );
      } else {
        const bytes = await mod.buildAnswerPdf(list, opts, setMsg);
        downloadBytes(bytes, `${safe}_정답해설.pdf`);
        setMsg("정답·해설지를 받았습니다.");
      }
    } catch (e: any) {
      setMsg("만들지 못했습니다: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 text-sm">
      <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="시험지 제목" aria-label="시험지 제목" />
      <input className="input" value={subtitle} maxLength={80} onChange={(e) => setSubtitle(e.target.value)} placeholder="부제(예: 김OO 학생 · 이차함수 복습)" aria-label="부제" />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
        앞뒤 표지 붙이기(메딕수학 표지·뒤 로고)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} />
        문항마다 출처(학교·번호·단원) 적기
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={perCol === 2} onChange={(e) => setPerCol(e.target.checked ? 2 : 3)} />
        풀이 공간 넉넉히(한 단에 2문항)
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => build("sheet")}>
          {busy ? "만드는 중…" : "시험지 PDF"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => build("answer")}>
          정답·해설지 PDF
        </button>
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
      {/* 2026-10-01: 시험지 = 학교 기출 원본을 오려 붙인 것, 정답·해설지 = 메딕 해설(lib/content/kinds.ts) */}
      <p className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
        <span>시험지</span>
        <ContentKindBadge kind="original" />
        <span>· 정답·해설지</span>
        <ContentKindBadge kind="medic" />
      </p>
      <p className="text-xs text-slate-400">받은 시험지·해설은 본인 과외 수업에만 써 주세요(다른 선생님에게 넘기거나 인터넷에 올리면 안 됩니다).</p>
    </div>
  );
}
