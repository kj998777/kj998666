"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { UnclassifiedExam } from "@/lib/similar/unclassified";
import { setLogicType } from "./actions";

// 유형 분류 탭 화면. 시험마다 과목을 정하고(시험 이름으로 짐작한 값이 기본) "AI로 분류"를 누르면 문항 10개씩
// /admin/logic-types/classify 를 불러 남은 문항이 없을 때까지 돌린다. "전부 AI로 분류"는 과목이 정해진 시험을 차례로.

type TypeOpt = { key: string; subject: string; label: string };
type Prog = { running: boolean; saved: number; missed: number; msg: string };

export default function LogicTypesClient({
  exams,
  subjects,
  types,
}: {
  exams: UnclassifiedExam[];
  subjects: Record<string, string>;
  types: TypeOpt[];
}) {
  const router = useRouter();
  const [subj, setSubj] = useState<Record<string, string>>(() =>
    Object.fromEntries(exams.map((e) => [e.examId, e.subject ?? e.usedSubject ?? ""]))
  );
  const [prog, setProg] = useState<Record<string, Prog>>({});
  const [allRunning, setAllRunning] = useState(false);
  const total = exams.reduce((a, e) => a + e.items.length, 0);

  async function runExam(examId: string): Promise<boolean> {
    const subject = subj[examId];
    if (!subject) return true;
    const skip: string[] = [];
    let saved = 0;
    setProg((p) => ({ ...p, [examId]: { running: true, saved: 0, missed: 0, msg: "AI가 분류하는 중…" } }));
    for (let guard = 0; guard < 30; guard++) {
      let j: any;
      try {
        const res = await fetch("/admin/logic-types/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ examId, subject, skip }),
        });
        j = await res.json();
      } catch {
        j = { ok: false, msg: "네트워크 오류" };
      }
      if (!j.ok) {
        setProg((p) => ({ ...p, [examId]: { running: false, saved, missed: skip.length, msg: "실패: " + (j.msg || "알 수 없는 오류") } }));
        return false;
      }
      saved += j.saved;
      skip.push(...(j.missed ?? []));
      setProg((p) => ({ ...p, [examId]: { running: true, saved, missed: skip.length, msg: `${saved}개 정함…` } }));
      if (!j.left) break;
    }
    setProg((p) => ({
      ...p,
      [examId]: { running: false, saved, missed: skip.length, msg: `${saved}개 정함` + (skip.length ? ` · AI가 못 정한 ${skip.length}개는 직접 골라 주세요` : "") },
    }));
    return true;
  }

  async function runAll() {
    setAllRunning(true);
    for (const e of exams) {
      if (!subj[e.examId]) continue;
      const ok = await runExam(e.examId);
      if (!ok) break; // 크레딧 부족 등 — 멈춤
    }
    setAllRunning(false);
    router.refresh();
  }

  if (!exams.length) return <div className="card text-sm text-slate-600">유형이 빈 문항이 없습니다. 모든 문항에 논리 유형이 정해져 있어요.</div>;
  const ready = exams.filter((e) => subj[e.examId]).length;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div className="text-sm text-slate-700">
          유형이 빈 문항 <b className="tabular-nums">{total}</b>개 · 시험 <b className="tabular-nums">{exams.length}</b>개
          {ready < exams.length && <span className="text-amber-700"> (과목을 모르는 시험 {exams.length - ready}개는 과목을 먼저 골라 주세요)</span>}
        </div>
        <button type="button" className="btn-primary ml-auto" disabled={allRunning || !ready} onClick={runAll}>
          {allRunning ? "분류하는 중…" : "과목이 정해진 시험 전부 AI로 분류"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        AI는 시험지 PDF 없이 문항 요약·풀이 글만 보고 고릅니다(문항 10개에 몇 초, 비용은 아주 적음). 유형표가 없는 과목(예: 미적분·수학Ⅰ)은 분류할 수 없어
        과목을 &ldquo;유형표 없음&rdquo;으로 두면 됩니다.
      </p>

      {exams.map((e) => (
        <ExamBox
          key={e.examId}
          e={e}
          subject={subj[e.examId] ?? ""}
          onSubject={(v) => setSubj((s) => ({ ...s, [e.examId]: v }))}
          subjects={subjects}
          types={types}
          prog={prog[e.examId]}
          disabled={allRunning}
          onRun={async () => {
            await runExam(e.examId);
            router.refresh();
          }}
        />
      ))}
    </div>
  );
}

function ExamBox({
  e,
  subject,
  onSubject,
  subjects,
  types,
  prog,
  disabled,
  onRun,
}: {
  e: UnclassifiedExam;
  subject: string;
  onSubject: (v: string) => void;
  subjects: Record<string, string>;
  types: TypeOpt[];
  prog?: Prog;
  disabled: boolean;
  onRun: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opts = types.filter((t) => t.subject === subject);
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-left min-w-0 flex-1" onClick={() => setOpen((v) => !v)}>
          <span className="text-slate-400 mr-1">{open ? "▾" : "▸"}</span>
          <span className="font-medium break-words">{e.name}</span>
          <span className="ml-2 badge bg-slate-100 text-slate-600">{e.status}</span>
          <span className="ml-2 text-sm text-slate-500 tabular-nums">유형 빈 문항 {e.items.length}개</span>
        </button>
        <select className="input w-auto py-1 text-sm" value={subject} onChange={(ev) => onSubject(ev.target.value)} disabled={disabled || prog?.running}>
          <option value="">과목 선택 / 유형표 없음</option>
          {Object.entries(subjects).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
              {k === e.subject ? " (이름으로 짐작)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary py-1 px-3 text-sm" disabled={!subject || disabled || prog?.running} onClick={onRun}>
          {prog?.running ? "분류하는 중…" : "AI로 분류"}
        </button>
      </div>
      {prog?.msg && <p className={"text-sm " + (prog.msg.startsWith("실패") ? "text-red-600" : "text-emerald-700")}>{prog.msg}</p>}
      {open && (
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2 w-14">번호</th>
                <th className="py-2 pr-2">단원 · 문제 요약</th>
                <th className="py-2 pr-2 w-64">유형 직접 고르기</th>
              </tr>
            </thead>
            <tbody>
              {e.items.map((it) => (
                <ItemRow key={it.id} it={it} opts={opts} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ItemRow({ it, opts }: { it: UnclassifiedExam["items"][number]; opts: TypeOpt[] }) {
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-2 font-medium tabular-nums">{it.label}</td>
      <td className="py-2 pr-2">
        <div className="text-slate-700">
          {it.unit || "-"}
          {it.difficulty && <span className="ml-1 text-xs text-slate-500">({it.difficulty})</span>}
        </div>
        <div className="text-xs text-slate-500 break-words">{it.statement}</div>
      </td>
      <td className="py-2 pr-2">
        {opts.length ? (
          <div className="flex items-center gap-1">
            <select className="input py-1 text-xs" value={val} onChange={(ev) => setVal(ev.target.value)} disabled={pending || msg === "저장됨"}>
              <option value="">고르기</option>
              {opts.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key.split(".")[1]} · {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary py-1 px-2 text-xs"
              disabled={!val || pending || msg === "저장됨"}
              onClick={() =>
                start(async () => {
                  const r = await setLogicType(it.id, val);
                  setMsg(r.ok ? "저장됨" : "실패: " + r.msg);
                })
              }
            >
              {msg === "저장됨" ? "저장됨" : "저장"}
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-400">과목을 먼저 고르세요</span>
        )}
        {msg && msg !== "저장됨" && <div className="text-xs text-red-600">{msg}</div>}
      </td>
    </tr>
  );
}
