"use client";

import { useMemo, useRef, useState } from "react";
import { LEVELS, type Level } from "@/lib/classLabel";

type ClassRow = { level: string; grade: number; name: string };
type Item = { item_label: string; type: "객관식" | "주관식" };

const LEVEL_TITLE: Record<Level, string> = { 초: "초등학교", 중: "중학교", 고: "고등학교" };
const SYMBOLS = ["√", "π", "×", "÷", "²", "≥", "≤"];

export default function StudentSubmitForm({
  code,
  examName,
  classes,
  items,
}: {
  code: string;
  examName: string;
  classes: ClassRow[];
  items: Item[];
}) {
  const [step, setStep] = useState<"level" | "grade" | "class" | "form">("level");
  const [level, setLevel] = useState<Level | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => items.map(() => ""));
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
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
      const res = await fetch(`/api/submit/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lv: level, grade, cls, name, answers }),
      });
      const json = await res.json();
      setResult({ ok: !!json.ok, msg: json.msg ?? (json.ok ? "제출 완료" : "제출하지 못했습니다.") });
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
                  setStep("form");
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "form" && level && grade !== null && cls && (
        <div className="space-y-4">
          <BackBar onBack={() => setStep("class")} title={`${level}${grade} ${cls}`} />

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

          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.item_label} className="flex items-center gap-2">
                <span className="w-10 text-sm text-slate-500 text-right">{it.item_label}번</span>
                {it.type === "객관식" && (
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={
                          "btn-secondary py-1 px-2 " +
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
                  className="input flex-1"
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
