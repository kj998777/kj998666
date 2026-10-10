"use client";

import { useState, useTransition } from "react";
import { deleteSubmission, setItemManualCorrect } from "./actions";
import { guessSummary } from "@/lib/grading";

type PerItem = { item_label: string; given: string; correct: boolean; points: number; guessed?: boolean; manual?: boolean };
type Row = {
  id: string;
  class_label: string;
  student_name: string;
  submitted_at: string;
  total_score: number;
  per_item: PerItem[];
};

// pickHref(2026-10-05): 오답 유사문제 고르기 화면 주소 앞부분 — 뒤에 제출 id를 붙인다. 없으면 링크를 감춘다.
// canGrade(2026-10-10): 펼친 문항 칸을 눌러 선생님이 직접 맞음 처리하거나 되돌린다(관리자).
export default function ResultRow({
  code,
  row,
  canDelete,
  canGrade = false,
  pickHref,
}: {
  code: string;
  row: Row;
  canDelete: boolean;
  canGrade?: boolean;
  pickHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [gradeMsg, setGradeMsg] = useState("");
  const toggleManual = (it: PerItem) => {
    const undo = !!it.manual;
    if (!undo && it.correct) return; // 이미 자동으로 맞음
    const q = undo
      ? `${row.student_name} 학생 ${it.item_label}번의 '선생님 맞음 처리'를 되돌려 자동 채점대로 할까요?`
      : `${row.student_name} 학생 ${it.item_label}번(답: ${it.given || "무응답"})을 맞음으로 처리할까요?`;
    if (!confirm(q)) return;
    start(async () => {
      setGradeMsg("");
      const r = await setItemManualCorrect(code, row.id, it.item_label, !undo);
      setGradeMsg(r.ok ? `저장했습니다. 총점 ${r.total}점` : r.msg);
    });
  };
  const g = guessSummary(row.per_item, Number(row.total_score));

  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-2">{row.class_label}</td>
        <td className="py-2 pr-2">
          <button className="hover:underline" onClick={() => setOpen((v) => !v)}>
            {row.student_name}
          </button>
        </td>
        <td className="py-2 pr-2 font-medium">{row.total_score}</td>
        {/* 2026-10-01: 실질 점수 = 점수 − 찍어서 맞힌 점수(학생이 "찍음"으로 표시한 문항) */}
        <td className="py-2 pr-2">
          <span className={g.guessedPoints > 0 ? "font-medium text-amber-700" : "font-medium"}>{g.realScore}</span>
          {g.guessed > 0 && (
            <span className="ml-1 text-xs text-slate-400">
              (찍음 {g.guessed}개 중 {g.guessedCorrect}개 맞음)
            </span>
          )}
        </td>
        <td className="py-2 pr-2 text-slate-500">{new Date(row.submitted_at).toLocaleString("ko-KR")}</td>
        <td className="py-2 pr-2 text-right whitespace-nowrap">
          {pickHref && row.per_item.some((it) => !it.correct || it.guessed) && (
            <a href={pickHref + row.id} className="link-accent mr-3">
              유사문제 고르기
            </a>
          )}
          {canDelete && (
            <button
              className="text-slate-400 hover:text-red-600"
              disabled={pending}
              onClick={() => {
                if (!confirm(`${row.student_name} 학생의 제출을 삭제할까요? 다시 제출할 수 있게 됩니다.`)) return;
                start(async () => { await deleteSubmission(code, row.id); });
              }}
            >
              삭제(재제출 허용)
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="py-2 px-2">
            <div className="flex flex-wrap gap-1">
              {row.per_item.map((it) => {
                const clickable = canGrade && (!it.correct || !!it.manual);
                const Tag = clickable ? "button" : "span";
                return (
                  <Tag
                    key={it.item_label}
                    {...(clickable ? { type: "button" as const, disabled: pending, onClick: () => toggleManual(it) } : {})}
                    className={
                      "badge " +
                      (it.correct ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") +
                      (it.guessed ? " ring-2 ring-amber-400" : "") +
                      (clickable ? " cursor-pointer hover:opacity-80" : "")
                    }
                    title={
                      `정답 여부: ${it.correct ? "정답" : "오답"}${it.manual ? " (선생님 맞음 처리)" : ""}${it.guessed ? " · 찍음" : ""}` +
                      (clickable ? (it.manual ? " — 눌러서 되돌리기" : " — 눌러서 맞음 처리") : "")
                    }
                  >
                    {it.item_label}번: {it.given || "(무응답)"}
                    {it.manual && <span className="ml-1">(선생님 맞음)</span>}
                    {it.guessed && <span className="ml-1 text-amber-700">(찍음)</span>}
                  </Tag>
                );
              })}
            </div>
            {canGrade && (
              <p className="mt-1 text-xs text-slate-500">
                빨간 칸(오답)을 누르면 맞음으로 처리합니다. &ldquo;선생님 맞음&rdquo; 칸을 다시 누르면 되돌립니다.
                {gradeMsg && <span className="ml-2 text-slate-700">{gradeMsg}</span>}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
