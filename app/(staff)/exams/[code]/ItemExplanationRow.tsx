"use client";

import { useRef, useState, useTransition } from "react";
import { MathPreview, MathToolbar } from "@/app/_components/MathTools";
import { updateItemExplanation } from "./actions";
import ErrorCheckControl from "./ErrorCheckControl";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";

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
/** 같은 번호의 정답표 칸(없으면 null) — 정답 표시가 이것과 다르면 경고를 띄운다(2026-10-03). */
type KeyInfo = { type: string; correct_answers: string } | null;

// AnswerKeyRow.tsx 와 같은 패턴(로컬 useState + dirty flag + 저장 버튼 + useTransition).
// 직원(editor 이상)은 여기서 정답표시·풀이를 바로 고칠 수 있다 — 지금까지는 읽기 전용이었음.
export default function ItemExplanationRow({
  code,
  row,
  canEdit,
  isAdmin,
  initialCheck,
  keyInfo = null,
}: {
  code: string;
  row: Row;
  canEdit: boolean;
  isAdmin: boolean;
  initialCheck: CheckInfo;
  keyInfo?: KeyInfo;
}) {
  const [answer_display, setAnswer] = useState(row.answer_display);
  const [solution, setSolution] = useState(row.solution);
  const answerRef = useRef<HTMLInputElement | null>(null);
  const solutionRef = useRef<HTMLTextAreaElement | null>(null);
  const setAnswerDirty = (v: string) => {
    setAnswer(v);
    setSaved(false);
  };
  const setSolutionDirty = (v: string) => {
    setSolution(v);
    setSaved(false);
  };
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [warn, setWarn] = useState("");
  const dirty = answer_display !== row.answer_display || solution !== row.solution;
  // 저장된 정답 표시가 정답표(채점 기준)와 다른가 — 해설지·보고서에는 정답표 쪽이 보이므로 여기서 눈에 띄게 알린다.
  const keyCheck = keyInfo ? reconcileKeyDisplay(keyInfo.type, keyInfo.correct_answers, row.answer_display) : null;
  const keyMismatch = !!keyCheck?.mismatch;

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
        {keyMismatch && <span className="badge bg-amber-100 text-amber-800">정답표({keyCheck!.text})와 다름</span>}
      </summary>
      <div className="mt-2 text-sm space-y-2 text-slate-700">
        {row.exam_error_suspected && (
          <div className="border border-red-200 bg-red-50 text-red-800 rounded px-3 py-2 text-sm space-y-1">
            <p className="font-medium">⚠ 출제오류 의심{row.exam_error_kind ? ` — ${row.exam_error_kind}` : ""}</p>
            {row.exam_error_reason && <p className="whitespace-pre-wrap">{row.exam_error_reason}</p>}
            {row.exam_error_student_note && <p className="text-red-700">학생 안내: {row.exam_error_student_note}</p>}
          </div>
        )}
        {keyMismatch && (
          <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded px-3 py-2 text-sm">
            해설의 정답 표시({row.answer_display})가 채점에 쓰는 정답표({keyCheck!.text})와 다릅니다. 해설지·보고서·학생
            화면에는 정답표 쪽({keyCheck!.text})이 보입니다. 어느 쪽이 맞는지 확인해서 위 정답표나 아래 정답표시를 고쳐 주세요.
          </div>
        )}
        {row.unit && <p className="text-slate-500">단원: {row.unit}</p>}
        {row.difficulty_reason && <p className="text-slate-500">난이도 판단: {row.difficulty_reason}</p>}
        {row.problem_statement && <p className="whitespace-pre-wrap">{row.problem_statement}</p>}

        {!canEdit ? (
          <>
            {(keyCheck?.text || row.answer_display) && (
              <p>
                <span className="font-medium">정답: </span>
                {keyCheck?.text || row.answer_display}
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
                ref={answerRef}
                className="input py-1"
                value={answer_display ?? ""}
                onChange={(e) => setAnswerDirty(e.target.value)}
              />
              <MathToolbar target={answerRef} value={answer_display ?? ""} onChange={setAnswerDirty} circled />
              <MathPreview text={answer_display ?? ""} className="mt-1" />
            </div>
            <div>
              <label className="label">풀이</label>
              <MathToolbar target={solutionRef} value={solution ?? ""} onChange={setSolutionDirty} />
              <textarea
                ref={solutionRef}
                className="input py-1 min-h-24 mt-1"
                value={solution ?? ""}
                onChange={(e) => setSolutionDirty(e.target.value)}
              />
              <MathPreview text={solution ?? ""} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  className="btn-secondary py-1 px-3"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setErr("");
                      setWarn("");
                      const r = await updateItemExplanation(code, row.id, { answer_display, solution });
                      if (!r.ok) setErr(r.msg ?? "실패");
                      else {
                        setSaved(true);
                        if (r.msg) setWarn(r.msg);
                      }
                    })
                  }
                >
                  저장
                </button>
              )}
              {saved && !dirty && <span className="text-xs text-emerald-600">저장됨</span>}
              {err && <span className="text-xs text-red-600">{err}</span>}
              {warn && <span className="text-xs text-amber-700">{warn}</span>}
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
