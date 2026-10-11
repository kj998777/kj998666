"use client";

import { useMemo, useRef, useState } from "react";
import { LEVELS, type Level } from "@/lib/classLabel";
import PromoBanner from "@/app/_components/PromoBanner";
import { choiceOfLabel, displayNo } from "@/lib/exams/mockCsat";
import type { StudentResult } from "@/lib/report/studentResult";

type ClassRow = { level: string; grade: number; name: string };
type Item = { item_label: string; type: "객관식" | "주관식" };

const LEVEL_TITLE: Record<Level, string> = { 초: "초등학교", 중: "중학교", 고: "고등학교" };
const SYMBOLS = ["√", "π", "×", "÷", "²", "≥", "≤"];

export default function StudentSubmitForm({
  code,
  examName,
  classes,
  items,
  tutorToken = null,
  endpoint = null,
  promo = false,
  choices = [],
}: {
  code: string;
  examName: string;
  classes: ClassRow[];
  items: Item[];
  // #4: 과외선생님 전용 링크로 들어왔으면 반 선택 없이 바로 이름·답 입력
  tutorToken?: string | null;
  // 2026-10-01 입학테스트(/p/코드): 반 선택 없이 이름·답만 받아 이 주소로 보낸다
  endpoint?: string | null;
  /** 2026-10-01: 제출 완료 화면에 메딕수학 홍보 배너(학원·과외선생님 학생 모두) */
  promo?: boolean;
  /** 2026-10-11 고3 사설 모의고사: 선택과목(있으면 답 입력 전에 고름 — 공통 + 고른 과목 문항만 보임) */
  choices?: { key: string; name: string }[];
}) {
  const direct = !!tutorToken || !!endpoint;
  const hasChoice = choices.length > 0;
  const firstAfterClass = hasChoice ? "choice" : "form";
  const [step, setStep] = useState<"level" | "grade" | "class" | "choice" | "form">(direct ? firstAfterClass : "level");
  const [choice, setChoice] = useState<string | null>(null);
  // 선택과목이 있으면 공통 문항 + 고른 과목 문항만(번호 순서는 정답표 그대로)
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => {
    const c = choiceOfLabel(it.item_label);
    return c === null || c === choice;
  });
  const [level, setLevel] = useState<Level | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => items.map(() => ""));
  // 2026-10-01 원장님 요청: 문항마다 "찍음" 표시 — 점수는 그대로, 보고서에 "실질 점수"(찍어서 맞힌 점수를 뺀 점수)를 함께 보여 준다
  const [guessed, setGuessed] = useState<boolean[]>(() => items.map(() => false));
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; submissionId?: string; mine?: StudentResult | null } | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const gradesForLevel = useMemo(() => {
    if (!level) return [];
    return Array.from(new Set(classes.filter((c) => c.level === level).map((c) => c.grade))).sort((a, b) => a - b);
  }, [classes, level]);

  const classesForGrade = useMemo(() => {
    if (!level || grade === null) return [];
    return classes.filter((c) => c.level === level && c.grade === grade).map((c) => c.name);
  }, [classes, level, grade]);

  function insertSymbol(sym: string) {
    if (activeIdx === null) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[activeIdx] = (next[activeIdx] ?? "") + sym;
      return next;
    });
    inputRefs.current[activeIdx]?.focus();
  }

  async function submit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(endpoint ?? `/api/submit/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          (() => {
            // 선택과목 시험이면 보이는 문항(공통 + 고른 과목)의 답만, 과목과 함께 보낸다
            const a = hasChoice ? shown.map(({ i }) => answers[i] ?? "") : answers;
            const g = hasChoice ? shown.map(({ i }) => guessed[i] ?? false) : guessed;
            const extra = hasChoice ? { choice } : {};
            return endpoint
              ? { name, answers: a, guessed: g, ...extra }
              : tutorToken
                ? { t: tutorToken, name, answers: a, guessed: g, ...extra }
                : { lv: level, grade, cls, name, answers: a, guessed: g, ...extra };
          })()
        ),
      });
      const json = await res.json();
      setResult({
        ok: !!json.ok,
        msg: json.msg ?? (json.ok ? "제출 완료" : "제출하지 못했습니다."),
        submissionId: typeof json.submissionId === "string" ? json.submissionId : undefined,
        mine: json.result && typeof json.result === "object" ? (json.result as StudentResult) : null,
      });
    } catch {
      setResult({ ok: false, msg: "네트워크 오류로 제출하지 못했습니다. 다시 시도해 주세요." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <Wrap>
        <div className="text-center py-6">
          <div className="text-2xl mb-2">✅</div>
          <p className="font-medium">제출 완료했습니다.</p>
          <p className="text-sm text-slate-500 mt-1">{name} 학생, 수고했어요.</p>
        </div>
        {result.mine && <MyResult r={result.mine} />}
        {/* 2026-10-05 원장님: 틀린 문제와 같은 논리 유형의 다른 학교 문제(app/r/[sid]) — 입학테스트는 제외.
            같은 날 "학생이 아니라 선생님이 선택": 문제는 선생님이 골라 주고, 학생은 이 링크(또는 보고서 QR)로 연다. */}
        {!endpoint && result.submissionId && (
          <div className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-center text-sm text-slate-600">
            선생님이 틀린 문제에 맞는 유사문제를 골라 주시면{" "}
            <a href={`/r/${result.submissionId}`} className="link-accent">
              이 링크
            </a>
            에서 풀 수 있어요.
          </div>
        )}
        {promo && <PromoBanner />}
      </Wrap>
    );
  }

  return (
    <Wrap>
      <h1 className="font-semibold mb-4">{examName}</h1>

      {step === "level" && (
        <div className="space-y-2">
          <p className="label">학교급을 골라 주세요</p>
          <div className="flex gap-2">
            {LEVELS.map((lv) => (
              <button
                key={lv}
                className="btn-secondary flex-1"
                onClick={() => {
                  setLevel(lv);
                  setStep("grade");
                }}
              >
                {LEVEL_TITLE[lv]}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "grade" && level && (
        <div className="space-y-2">
          <BackBar onBack={() => setStep("level")} title={`${LEVEL_TITLE[level]} — 학년`} />
          {gradesForLevel.length === 0 ? (
            <p className="text-sm text-slate-500">이 학교급에는 등록된 반이 없습니다. 다른 학교급을 골라 주세요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {gradesForLevel.map((g) => (
                <button
                  key={g}
                  className="btn-secondary"
                  onClick={() => {
                    setGrade(g);
                    setStep("class");
                  }}
                >
                  {g}학년
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "class" && level && grade !== null && (
        <div className="space-y-2">
          <BackBar onBack={() => setStep("grade")} title={`${LEVEL_TITLE[level]} ${grade}학년 — 반`} />
          <div className="flex flex-wrap gap-2">
            {classesForGrade.map((c) => (
              <button
                key={c}
                className="btn-secondary"
                onClick={() => {
                  setCls(c);
                  setStep(firstAfterClass);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "choice" && (
        <div className="space-y-2">
          {!direct && <BackBar onBack={() => setStep("class")} title={`${level}${grade} ${cls}`} />}
          <p className="text-sm text-slate-600">선택과목을 골라 주세요. 23~30번은 고른 과목 문항만 나옵니다.</p>
          <div className="grid gap-2">
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  setChoice(c.key);
                  setStep("form");
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "form" && (direct || (level && grade !== null && cls)) && (!hasChoice || choice) && (
        <div className="space-y-4">
          {hasChoice ? (
            <BackBar onBack={() => setStep("choice")} title={`${!direct ? `${level}${grade} ${cls} · ` : ""}선택과목 ${choices.find((c) => c.key === choice)?.name ?? ""}`} />
          ) : (
            !direct && <BackBar onBack={() => setStep("class")} title={`${level}${grade} ${cls}`} />
          )}

          <div>
            <label className="label">이름</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          </div>

          <div className="sticky top-0 bg-white py-1 flex flex-wrap gap-1 border-b border-slate-100 z-10">
            {SYMBOLS.map((s) => (
              <button key={s} type="button" className="btn-secondary py-1 px-2" onClick={() => insertSymbol(s)}>
                {s}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500 -mb-1">
            확실하지 않아 <b>찍은 문항</b>은 번호 아래 <b>찍음</b>을 눌러 표시해 주세요. 점수에는 영향이 없고, 실력을 정확히 보는 데만 씁니다.
          </p>
          <div className="space-y-2">
            {shown.map(({ it, i }) => (
              <div key={it.item_label} className={"flex items-center gap-1.5 " + (guessed[i] ? "rounded-lg bg-amber-50 -mx-1 px-1" : "")}>
                {/* 2026-10-01: 번호 아래 작은 "찍음" 버튼(줄 너비는 그대로 — 휴대폰에서 ①~⑤ 버튼이 좁아지지 않게) */}
                <div className="w-9 shrink-0 flex flex-col items-end gap-1">
                  <span className="text-sm text-slate-500">{displayNo(it.item_label)}번</span>
                  <button
                    type="button"
                    aria-pressed={guessed[i]}
                    aria-label={`${displayNo(it.item_label)}번 찍음`}
                    className={
                      "rounded-full border px-1 py-1 text-[11px] leading-none font-medium " +
                      (guessed[i] ? "border-amber-500 bg-amber-400 text-white" : "border-slate-300 bg-white text-slate-500")
                    }
                    onClick={() =>
                      setGuessed((prev) => {
                        const next = [...prev];
                        next[i] = !next[i];
                        return next;
                      })
                    }
                  >
                    찍음
                  </button>
                </div>
                {it.type === "객관식" && (
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={
                          // 학생이 휴대폰으로 누르는 버튼 — 손가락으로 누르기 쉽게 기본 버튼 크기를 그대로 쓴다.
                          "btn-secondary " +
                          (answers[i] === String(n) ? "!bg-slate-900 !text-white" : "")
                        }
                        onClick={() =>
                          setAnswers((prev) => {
                            const next = [...prev];
                            next[i] = String(n);
                            return next;
                          })
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  className="input flex-1 min-w-0"
                  value={answers[i] ?? ""}
                  onFocus={() => setActiveIdx(i)}
                  onChange={(e) =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  maxLength={200}
                />
              </div>
            ))}
          </div>

          {result && !result.ok && <p className="text-sm text-red-600">{result.msg}</p>}

          <button className="btn-primary w-full" disabled={submitting || !name.trim()} onClick={submit}>
            {submitting ? "제출하는 중…" : "제출하기"}
          </button>
        </div>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-8">
      <div className="card w-full max-w-md">{children}</div>
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
      <button onClick={onBack} className="hover:text-slate-800">
        ← 다시 고르기
      </button>
      <span>/</span>
      <span>{title}</span>
    </div>
  );
}

// 2026-10-11 원장님 "학생 제출 화면에서도 점수 및 어떤 문제 틀렸고 이런 통계 결과는 볼 수 있게(해설은 못 보게)".
// 정답·풀이는 보여 주지 않는다(제출 API가 애초에 보내지 않음 — lib/report/studentResult.ts).
function MyResult({ r }: { r: StudentResult }) {
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const chips = (list: string[], cls: string) => (
    <div className="flex flex-wrap gap-1.5">
      {list.map((x) => (
        <span key={x} className={"inline-flex min-w-[2.25rem] justify-center rounded-md px-2 py-0.5 text-sm tabular-nums " + cls}>
          {x}번
        </span>
      ))}
    </div>
  );
  return (
    <div className="mb-4 space-y-4 rounded-lg border border-slate-200 px-4 py-4">
      <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-2 text-center">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {r.total}
            <span className="text-base font-normal text-slate-500"> / {r.max}점</span>
          </div>
          <div className="text-xs text-slate-500">내 점수</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums">
            {r.correct}
            <span className="text-sm font-normal text-slate-500"> / {r.n}</span>
          </div>
          <div className="text-xs text-slate-500">맞힌 문항</div>
        </div>
        {r.grade && (
          <div>
            <div className="text-xl font-semibold">{r.grade.label}</div>
            <div className="text-xs text-slate-500">예상 등급({r.grade.choice})</div>
          </div>
        )}
      </div>
      {r.grade && (
        <p className="text-center text-xs text-slate-500">
          해설지의 전국 예상 등급컷 {r.grade.cuts.map((c, i) => `${i + 1}컷 ${c}`).join(" · ")}점 기준 — 실제 등급과 다를 수 있어요.
        </p>
      )}

      <div className="space-y-2">
        <div>
          <div className="mb-1 text-sm font-medium">틀린 문항 {r.wrong.length}개</div>
          {r.wrong.length ? chips(r.wrong, "bg-red-50 text-red-700") : <p className="text-sm text-slate-500">없어요. 잘했어요!</p>}
        </div>
        {r.blank.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium">답을 안 적은 문항 {r.blank.length}개</div>
            {chips(r.blank, "bg-slate-100 text-slate-600")}
          </div>
        )}
        {r.guessedRight.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium">찍어서 맞힌 문항 {r.guessedRight.length}개</div>
            {chips(r.guessedRight, "bg-amber-50 text-amber-800")}
            <p className="mt-1 text-xs text-slate-500">맞았지만 확실하지 않았던 문항이에요. 수업에서 다시 확인해 보세요.</p>
          </div>
        )}
      </div>

      {r.areas.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-medium">영역별 득점</div>
          <ul className="space-y-1.5">
            {r.areas.map((a) => (
              <li key={a.area} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{a.area}</span>
                  <span className="shrink-0 tabular-nums text-slate-600">
                    {a.earned} / {a.total}점 ({pct(a.earned, a.total)}%)
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${pct(a.earned, a.total)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.byPoints.length > 1 && (
        <div>
          <div className="mb-1 text-sm font-medium">배점별 맞힌 문항</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {r.byPoints.map((b) => (
              <span key={b.points} className="rounded-md bg-slate-50 px-2 py-1 tabular-nums">
                {b.points}점 문항 {b.correct}/{b.n}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">정답과 풀이는 선생님 수업에서 함께 확인해요.</p>
    </div>
  );
}
