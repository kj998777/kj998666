"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Analysis } from "@/lib/students/analysis";
import { mergeStudents, saveStudentMemo, setStudentHidden, unmergeStudent } from "../actions";
import { addToCart } from "@/lib/bank/cart";

type Candidate = { key: string; id: string; classText: string; nExams: number; lastAt: string };

export default function StudentTools({
  studentKey,
  name,
  classText,
  analysis,
  memo: memo0,
  hidden,
  canEdit,
  candidates,
  members,
  canBank = false,
}: {
  studentKey: string;
  name: string;
  classText: string;
  analysis: Analysis;
  memo: string;
  hidden: boolean;
  canEdit: boolean;
  candidates: Candidate[];
  members: { key: string; label: string }[];
  /** 문항 은행(편집자 이상)으로 복습지 만들기 */
  canBank?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [classAvg, setClassAvg] = useState(false);
  const [review, setReview] = useState(true);
  const [memo, setMemo] = useState(memo0);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const dirty = memo !== memo0;

  async function onPdf() {
    setBusy(true);
    setPdfMsg(null);
    try {
      const { downloadStudentReport } = await import("./buildStudentReport");
      await downloadStudentReport({ name, classText, analysis, memo, opts: { classAvg, review } }, (m) => setPdfMsg(m));
      setPdfMsg("PDF를 받았습니다.");
    } catch (e: any) {
      setPdfMsg("PDF를 만들지 못했습니다: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  function run(fn: () => Promise<{ ok: boolean; msg?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      try {
        const r: any = await fn();
        if (!r.ok) setMsg({ ok: false, text: r.msg || "처리하지 못했습니다." });
        else {
          setMsg({ ok: true, text: okText });
          router.refresh();
        }
      } catch (e: any) {
        setMsg({ ok: false, text: "처리하지 못했습니다. 새로고침 후 다시 시도해 주세요." });
      }
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card space-y-3">
        <h2 className="font-medium">누적 성적 보고서 PDF</h2>
        <p className="text-sm text-slate-600">
          학부모 상담용 — 요약, 점수 추이 그래프, 영역·난이도별 정답률, 우선 복습할 단원, 다시 풀어 볼 문항(해설 포함), 상담 메모가 들어갑니다.
        </p>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
            다시 풀어 볼 문항과 해설 넣기
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={classAvg} onChange={(e) => setClassAvg(e.target.checked)} />
            같은 반 평균 넣기 <span className="text-xs text-slate-400">(기본은 빼 둠 — 다른 학생과 비교가 부담스러울 수 있어서)</span>
          </label>
        </div>
        <button type="button" className="btn-primary" disabled={busy || analysis.exams.length === 0} onClick={onPdf}>
          {busy ? "만드는 중…" : "누적 보고서 PDF 받기"}
        </button>
        {dirty && <p className="text-xs text-amber-700">상담 메모를 아직 저장하지 않았어도 지금 적힌 내용이 PDF에 들어갑니다.</p>}
        {canBank && analysis.review.some((r) => r.item.id) && (
          <div className="border-t border-slate-100 pt-3 space-y-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                addToCart(analysis.review.map((r) => r.item.id).filter((x): x is string => !!x));
                router.push("/bank");
              }}
            >
              다시 풀 문항으로 복습지 만들기 →
            </button>
            <p className="text-xs text-slate-500">아래 &ldquo;다시 풀어 볼 문항&rdquo;을 문항 은행에 담고 넘어갑니다. 거기서 새 시험지와 정답·해설지 PDF를 받을 수 있어요.</p>
          </div>
        )}
        {pdfMsg && <p className="text-sm text-slate-600">{pdfMsg}</p>}
      </div>

      <div className="card space-y-3">
        <h2 className="font-medium">상담 메모</h2>
        <textarea
          className="input min-h-[7rem]"
          value={memo}
          maxLength={4000}
          placeholder={canEdit ? "상담 때 전할 말, 숙제·보충 계획 등(보고서의 '선생님 의견'에 들어갑니다)" : "편집자·관리자만 저장할 수 있습니다(보고서에는 여기 적은 글이 들어갑니다)."}
          onChange={(e) => setMemo(e.target.value)}
        />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" disabled={pending || !dirty} onClick={() => run(() => saveStudentMemo(studentKey, memo), "메모를 저장했습니다.")}>
              메모 저장
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              disabled={pending}
              onClick={() => run(() => setStudentHidden(studentKey, !hidden), hidden ? "다시 목록에 보입니다." : "목록에서 숨겼습니다.")}
            >
              {hidden ? "목록에 다시 보이기" : "목록에서 숨기기(시험용 제출 등)"}
            </button>
          </div>
        )}
      </div>

      {canEdit && (candidates.length > 0 || members.length > 0) && (
        <div className="card space-y-3 md:col-span-2">
          <h2 className="font-medium">같은 학생 합치기</h2>
          {candidates.length > 0 && (
            <>
              <p className="text-sm text-slate-600">
                이름이 같은 다른 기록입니다. 학년이 올라가 반이 바뀌었거나 같은 학생이면 합쳐 주세요 — 성적이 한 학생으로 모입니다(언제든 다시 풀 수 있음).
              </p>
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span>
                      <a href={`/students/${c.id}`} className="font-medium hover:underline">
                        {name}
                      </a>{" "}
                      · {c.classText} · 시험 {c.nExams}회 · 최근 {new Date(c.lastAt).toLocaleDateString("ko-KR")}
                    </span>
                    {confirmKey === c.key ? (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          className="btn-primary py-1 px-3 text-sm"
                          disabled={pending}
                          onClick={() => {
                            setConfirmKey(null);
                            run(() => mergeStudents(c.key, studentKey), "합쳤습니다.");
                          }}
                        >
                          정말 합치기
                        </button>
                        <button type="button" className="btn-secondary py-1 px-3 text-sm" onClick={() => setConfirmKey(null)}>
                          취소
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-secondary py-1 px-3 text-sm" disabled={pending} onClick={() => setConfirmKey(c.key)}>
                        이 학생에 합치기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {members.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="text-slate-600">합쳐 둔 기록</p>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-700">{m.label}</span>
                    <button type="button" className="text-sm text-slate-500 hover:underline" disabled={pending} onClick={() => run(() => unmergeStudent(m.key), "따로 떼어 냈습니다.")}>
                      따로 떼기
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {msg && <p className={"md:col-span-2 text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
