"use client";

import { useState, useTransition } from "react";
import { updateItemExplanation } from "./actions";
import ErrorCheckControl from "./ErrorCheckControl";

type Row = {
  id: string;
  item_label: string;
  area: string;
  unit: string;
  difficulty: string;
  difficulty_reason: string;
  problem_statement: string;
  answer_display: string;
  solution: string;
  points_assigned: boolean;
  exam_error_suspected: boolean;
  exam_error_kind: string;
  exam_error_reason: string;
  exam_error_student_note: string;
};

type CheckInfo = { stage: string; message: string; updatedAt: string } | null;

// AnswerKeyRow.tsx 와 같은 패턴(로컬 useState + dirty flag + 저장 버튼 + useTransition).
// 직원(editor 이상)은 여기서 정답표시·풀이를 바로 고칠 수 있다 — 지금까지는 읽기 전용이었음.
export default function ItemExplanationRow({
  code,
  row,
  canEdit,
  isAdmin,
  initialCheck,
}: {
  code: string;
  row: Row;
  canEdit: boolean;
  isAdmin: boolean;
  initialCheck: CheckInfo;
}) {
  const [answer_display, setAnswer] = useState(row.answer_display);
  const [solution, setSolution] = useState(row.solution);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = answer_display !== row.answer_display || solution !== row.solution;

  return (
    <details className="border border-slate-200 rounded px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
        <span>{row.item_label}번</span>
        <span className="text-slate-400 font-normal">
          {row.area && `${row.area} · `}
          {row.difficulty}
          {row.points_assigned && " · 배점임의"}
        </span>
        {row.exam_error_suspected && <span className="badge bg-red-100 text-red-700">⚠ 출제오류 의심</span>}
      </summary>
      <div className="mt-2 text-sm space-y-2 text-slate-700">
        {row.exam_error_suspected && (
          <div className="border border-red-200 bg-red-50 text-red-800 rounded px-3 py-2 text-sm space-y-1">
            <p className="font-medium">⚠ 출제오류 의심{row.exam_error_kind ? ` — ${row.exam_error_kind}` : ""}</p>
            {row.exam_error_reason && <p className="whitespace-pre-wrap">{row.exam_error_reason}</p>}
            {row.exam_error_student_note && <p className="text-red-700">학생 안내: {row.exam_error_student_note}</p>}
          </div>
        )}
        {row.unit && <p className="text-slate-500">단원: {row.unit}</p>}
        {row.difficulty_reason && <p className="text-slate-500">난이도 판단: {row.difficulty_reason}</p>}
        {row.problem_statement && <p className="whitespace-pre-wrap">{row.problem_statement}</p>}

        {!canEdit ? (
          <>
            {row.answer_display && (
              <p>
                <span className="font-medium">정답: </span>
                {row.answer_display}
              </p>
            )}
            {row.solution && (
              <div>
                <p className="font-medium">풀이</p>
                <p className="whitespace-pre-wrap">{row.solution}</p>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <div>
              <label className="label">정답표시</label>
              <input
                className="input py-1"
                value={answer_display}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div>
              <label className="label">풀이</label>
              <textarea
                className="input py-1 min-h-24"
                value={solution}
                onChange={(e) => {
                  setSolution(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  className="btn-secondary py-1 px-3"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setErr("");
                      const r = await updateItemExplanation(code, row.id, { answer_display, solution });
                      if (!r.ok) setErr(r.msg ?? "실패");
                      else setSaved(true);
                    })
                  }
                >
                  저장
                </button>
              )}
              {saved && !dirty && <span className="text-xs text-emerald-600">저장됨</span>}
              {err && <span className="text-xs text-red-600">{err}</span>}
            </div>
          </div>
        )}

        {isAdmin && (
          <ErrorCheckControl
            code={code}
            label={row.item_label}
            suspected={row.exam_error_suspected}
            initialCheck={initialCheck}
          />
        )}
      </div>
    </details>
  );
}
