"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSolveItem } from "../../actions";
import { MathPreview, MathToolbar } from "@/app/_components/MathTools";
import { latexToPlain } from "@/lib/grading";
import { mcChoices } from "@/lib/review/mcAnswer";

// 2026-09-30 원장님 요청: 과외선생님 제출 화면과 똑같이 객관식은 ①~⑤ 버튼으로 고른다(주관식은 정답 한 칸 + 수식 버튼).
// 정답표(채점용)와 정답 표시(해설용)는 고른 답에서 자동으로 만든다. 예전처럼 두 칸을 따로 적고 싶으면 "다른 모양으로 적기".
const CIRCLED = ["①", "②", "③", "④", "⑤"];

/** 고른 번호 → [정답표, 정답 표시]. either=true면 "어느 것을 골라도 정답"(복수 정답 인정, 정답표 1|3) */
export function mcKeyAndDisplay(picked: string[], either: boolean): [string, string] {
  const nums = CIRCLED.map((c, i) => (picked.includes(c) ? String(i + 1) : "")).filter(Boolean);
  const circ = CIRCLED.filter((c) => picked.includes(c));
  if (nums.length <= 1 || !either) return [nums.join(""), circ.join("")];
  return [nums.join("|"), circ.join(", ") + (nums.length === 5 ? " (모두 정답)" : " (복수 정답)")];
}

export default function AdminSolveForm({
  itemId,
  initialKey,
  initialDisplay,
  initialSolution,
  nextHref,
  answerType = "주관식",
}: {
  answerType?: "객관식" | "주관식";
  itemId: string;
  initialKey: string;
  initialDisplay: string;
  initialSolution: string;
  nextHref: string | null;
}) {
  const router = useRouter();
  const isMc = answerType === "객관식";
  // 처음 값: 정답표가 "1|3"이면 복수 정답 인정, "13"이면 둘 다 골라야 정답
  const initAlts = String(initialKey || "").split("|").map((x) => mcChoices(x)).filter(Boolean);
  const initPicked = isMc
    ? initAlts.length > 1 && initAlts.every((a) => a.length === 1)
      ? initAlts.map((a) => CIRCLED[Number(a) - 1])
      : Array.from(mcChoices(initialKey) || mcChoices(initialDisplay)).map((d) => CIRCLED[Number(d) - 1]).filter(Boolean)
    : [];
  const [picked, setPicked] = useState<string[]>(initPicked);
  const [either, setEither] = useState(initAlts.length > 1);
  // 객관식인데 번호로 읽을 수 없는 답이면 처음부터 직접 적기로
  const [free, setFree] = useState(isMc && !initPicked.length && !!(initialKey || initialDisplay));
  // 주관식: 정답 한 칸(정답 표시)에서 정답표를 만든다. "정답표 따로 적기"를 켜면 예전처럼 두 칸
  const [separate, setSeparate] = useState(!isMc && !!initialKey && !!initialDisplay && latexToPlain(initialDisplay).trim() !== latexToPlain(initialKey).trim());
  const [key, setKey] = useState(initialKey);
  const [display, setDisplay] = useState(initialDisplay);
  const buttons = isMc && !free;
  const oneBox = !isMc && !separate;
  const [solution, setSolution] = useState(initialSolution);
  const keyRef = useRef<HTMLInputElement | null>(null);
  const displayRef = useRef<HTMLInputElement | null>(null);
  const solutionRef = useRef<HTMLTextAreaElement | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (goNext: boolean) =>
    start(async () => {
      setMsg(null);
      let k = key;
      let d = display;
      if (buttons) {
        if (!picked.length) {
          setMsg({ ok: false, text: "정답 번호를 골라 주세요." });
          return;
        }
        [k, d] = mcKeyAndDisplay(picked, either);
      } else if (oneBox) {
        k = display;
      }
      const r = await adminSolveItem(itemId, { key: k, display: d, solution });
      if (!r.ok) {
        setMsg({ ok: false, text: r.msg ?? "저장하지 못했습니다." });
        return;
      }
      const extra = [r.regraded ? `제출 ${r.regraded}건 다시 채점` : "", r.examOpened ? "모든 문항이 확정되어 시험이 열렸습니다" : ""]
        .filter(Boolean)
        .join(" · ");
      setMsg({ ok: true, text: "저장하고 확정했습니다." + (extra ? ` (${extra})` : "") });
      if (goNext && nextHref) router.push(nextHref);
      else router.refresh();
    });

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">정답·해설 직접 등록</h2>
      {buttons ? (
        <div className="space-y-2">
          <label className="label">정답</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="정답 고르기">
            {CIRCLED.map((c) => {
              const on = picked.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  className={"h-11 w-11 rounded-lg border text-xl " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50")}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c) : CIRCLED.filter((x) => x === c || p.includes(x))))}
                >
                  {c}
                </button>
              );
            })}
            <button
              type="button"
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"
              title="문제 오류로 모든 번호를 정답 처리"
              onClick={() => {
                setPicked([...CIRCLED]);
                setEither(true);
              }}
            >
              모두 정답(문제 오류)
            </button>
          </div>
          {picked.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={!either} onChange={() => setEither(false)} />
                고른 번호를 <b>모두</b> 골라야 정답(답이 여러 개인 문제)
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={either} onChange={() => setEither(true)} />
                <b>어느 것을</b> 골라도 정답(복수 정답 인정)
              </label>
            </div>
          )}
          {picked.length > 0 && (
            <p className="text-xs text-slate-500">
              정답표(채점용) <b className="font-mono">{mcKeyAndDisplay(picked, either)[0]}</b> · 정답 표시 <b>{mcKeyAndDisplay(picked, either)[1]}</b>
            </p>
          )}
          <p className="text-xs text-slate-500">
            <button type="button" className="text-sky-700 hover:underline" onClick={() => {
                const [k, d] = mcKeyAndDisplay(picked, either);
                if (k) {
                  setKey(k);
                  setDisplay(d);
                }
                setFree(true);
              }}>
              다른 모양으로 적기(정답표·정답 표시 따로)
            </button>
          </p>
        </div>
      ) : oneBox ? (
        <div>
          <label className="label" htmlFor="adm-display">
            정답
          </label>
          <input
            id="adm-display"
            ref={displayRef}
            className="input"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="예: 3 또는 12.5 또는 3/4 (분수·루트는 아래 버튼, 여러 정답은 |)"
          />
          <MathToolbar target={displayRef} value={display} onChange={setDisplay} />
          <MathPreview text={display} className="mt-1" />
          {display.trim() && (
            <p className="text-xs text-slate-600 mt-1">
              정답표(채점용)에 저장될 모양: <b className="font-mono">{latexToPlain(display) || "—"}</b>
              <span className="text-slate-400"> (학생이 3/4·0.75·6/8 등으로 적어도 같은 값이면 정답)</span>
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            <button type="button" className="text-sky-700 hover:underline" onClick={() => {
                if (!key.trim()) setKey(display);
                setSeparate(true);
              }}>
              정답표 값 따로 적기
            </button>
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="adm-key">
                정답표(채점용)
              </label>
              <input id="adm-key" ref={keyRef} className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="예: 3 / 12 / 3/4 (여러 정답은 |)" />
              <p className="text-xs text-slate-400 mt-1">학생 답안 채점에 쓰는 값입니다. 객관식은 번호만(예: 3). 분수·루트는 아래 버튼으로 적어도 됩니다.</p>
              <MathToolbar target={keyRef} value={key} onChange={setKey} circled />
              {/[$\\]/.test(key) && (
                <p className="text-xs text-slate-600 mt-1">
                  정답표에 저장될 모양: <b className="font-mono">{latexToPlain(key) || "—"}</b>
                  <span className="text-slate-400"> (학생이 3/4·0.75·6/8 등으로 적어도 같은 값이면 정답)</span>
                </p>
              )}
              <MathPreview text={key} className="mt-1" />
            </div>
            <div>
              <label className="label" htmlFor="adm-display">
                정답 표시(해설용)
              </label>
              <input
                id="adm-display"
                ref={displayRef}
                className="input"
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                placeholder="비워 두면 정답표 값과 같게"
              />
              <p className="text-xs text-slate-400 mt-1">{"해설·보고서에 보이는 정답(예: ③, 12, $\\frac{3}{4}$)."}</p>
              <MathToolbar target={displayRef} value={display} onChange={setDisplay} circled />
              <MathPreview text={display} className="mt-1" />
            </div>
          </div>
          <p className="text-xs">
            <button type="button" className="text-sky-700 hover:underline" onClick={() => {
                if (isMc) {
                  const alts = key.split("|").map((x) => mcChoices(x)).filter(Boolean);
                  const one = alts.length > 1 && alts.every((a) => a.length === 1);
                  const nums = one ? alts : Array.from(mcChoices(key) || mcChoices(display));
                  setPicked(nums.map((d) => CIRCLED[Number(d) - 1]).filter(Boolean));
                  setEither(one);
                  setFree(false);
                } else setSeparate(false);
              }}>
              {isMc ? "①~⑤ 버튼으로 고르기" : "정답 한 칸으로 적기"}
            </button>
          </p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="adm-sol">
          풀이
        </label>
        <MathToolbar target={solutionRef} value={solution} onChange={setSolution} />
        <textarea
          id="adm-sol"
          ref={solutionRef}
          className="input min-h-[220px] font-mono text-sm mt-1"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이를 적어 주세요. 위 버튼으로 분수·루트·경우 나누기 같은 수식을 넣을 수 있고, 수식은 $...$ 로 감싸면 PDF·보고서에서 수식으로 보입니다."
        />
        <MathPreview text={solution} className="mt-2" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending} onClick={() => save(false)}>
          {pending ? "저장하는 중…" : "저장하고 확정"}
        </button>
        {nextHref && (
          <button className="btn-secondary" disabled={pending} onClick={() => save(true)}>
            저장하고 다음 문항
          </button>
        )}
      </div>
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
