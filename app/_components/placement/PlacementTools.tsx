"use client";

import { useEffect, useState, useTransition } from "react";
import { setPlacementOpen } from "@/lib/placement/actions";
import type { BankDetail } from "@/lib/bank/load";
import type { PerItemResult } from "@/lib/grading";

// 입학테스트 화면(0047)의 버튼들: 시험지 PDF(맨 뒤 답 제출 QR), 정답·해설지 PDF, 학생 진단 보고서 PDF, 제출 받기 열기/닫기.
// PDF는 모두 브라우저에서 만든다(문항 자세히는 /api/placement/<id>/items, 그림을 오릴 쪽은 /api/placement/<id>/page/<문항>).

const cache = new Map<string, Promise<BankDetail[]>>();
function loadItems(id: string): Promise<BankDetail[]> {
  if (!cache.has(id)) {
    cache.set(
      id,
      (async () => {
        const r = await fetch(`/api/placement/${id}/items`, { credentials: "same-origin", cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          cache.delete(id);
          throw new Error(j?.msg || "문항을 불러오지 못했습니다.");
        }
        return j.items as BankDetail[];
      })()
    );
  }
  return cache.get(id)!;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_");

export function PlacementPdfButtons({ id, code, title, scope }: { id: string; code: string; title: string; scope: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function build(kind: "sheet" | "answer") {
    setBusy(true);
    setMsg("");
    try {
      const list = await loadItems(id);
      const mod = await import("@/app/(staff)/bank/buildWorksheet");
      const { downloadBytes } = await import("@/app/(staff)/exams/[code]/results/buildReportPdf");
      const url = `${origin || window.location.origin}/p/${code}`;
      const opts = {
        title: title || "입학테스트",
        subtitle: scope ? `${scope} · ${list.length}문항 · 100점 만점` : "",
        showSource: false,
        perCol: 2 as const,
        pdfUrlOf: (it: BankDetail) => `/api/placement/${id}/page/${it.id}`,
        headRight: "이름 ____________   학교·학년 ____________",
        cover: "placement" as const, // 2026-10-01: 앞 표지(입학 진단 평가) + 맨 뒤 QR 쪽에 학원 로고
        qr: {
          url,
          heading: "다 풀었으면 답을 입력해 주세요",
          lines: ["휴대폰 카메라로 아래 QR을 찍으면 답 입력 화면이 열립니다.", "확실하지 않아 찍은 문항은 번호 아래 ‘찍음’을 눌러 주세요."],
        },
      };
      if (kind === "sheet") {
        const r = await mod.buildWorksheetPdf(list, opts, setMsg);
        downloadBytes(r.bytes, `${safeName(opts.title)}.pdf`);
        setMsg(
          `시험지 ${r.pages}쪽(앞 표지, 맨 뒤 답 제출 QR 포함)을 받았습니다.` +
            (r.textFallback.length ? ` 원래 시험지에서 자리를 못 찾은 ${r.textFallback.length}문항은 옮겨 적은 글로 넣었어요.` : "")
        );
      } else {
        const bytes = await mod.buildAnswerPdf(list, opts, setMsg);
        downloadBytes(bytes, `${safeName(opts.title)}_정답해설.pdf`);
        setMsg("정답·해설지를 받았습니다.");
      }
    } catch (e: any) {
      setMsg("만들지 못했습니다: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => build("sheet")}>
          {busy ? "만드는 중…" : "시험지 PDF (QR 포함)"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => build("answer")}>
          정답·해설지 PDF
        </button>
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}

export function PlacementReportButton({
  id,
  title,
  scope,
  student,
  promo = false,
}: {
  id: string;
  title: string;
  scope: string;
  student: { name: string; perItem: PerItemResult[]; createdAt: string };
  promo?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const items = await loadItems(id);
      const { ensureReportTools, htmlToPdfBytes, downloadBytes } = await import("@/app/(staff)/exams/[code]/results/buildReportPdf");
      const { buildPlacementHtml } = await import("./buildPlacementReport");
      const { katex } = await ensureReportTools((m) => setMsg(m));
      setMsg("보고서를 만드는 중…");
      const html = buildPlacementHtml(katex, {
        title: title || "입학테스트",
        scope,
        studentName: student.name,
        submittedAt: student.createdAt,
        items,
        perItem: student.perItem,
        promo,
      });
      const bytes = await htmlToPdfBytes(html);
      downloadBytes(bytes, `${safeName(student.name)}_입학테스트_진단.pdf`);
      setMsg("");
    } catch (e: any) {
      setMsg("실패: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={run}>
        {busy ? "만드는 중…" : "진단 보고서 PDF"}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

export function PlacementOpenToggle({ id, open }: { id: string; open: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary px-2 py-1 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setPlacementOpen(id, !open);
            setMsg(r.ok ? "" : r.msg || "바꾸지 못했습니다.");
          })
        }
      >
        {open ? "제출 받기 닫기" : "제출 다시 받기"}
      </button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </span>
  );
}
