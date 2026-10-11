"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CHOICES,
  CHOICE_NOS,
  COMMON_NOS,
  SOLUTION_PAGE_BATCH,
  GRADE_CUT_SLOTS,
  buildPageMap,
  cleanGradeCuts,
  csatSpec,
  pageMapToText,
  parsePageMapText,
  type ChoiceKey,
  type CsatAnswers,
  type GradeCuts,
  type PageEntry,
  type PageMap,
} from "@/lib/exams/mockCsat";
import { finalizeSolutionPdf, readMockAnswers, saveGradeCuts, saveMockKey, saveSolutionPageMap } from "../mock-actions";
import { pdfTooLarge, uploadSolutionPdfDirect } from "@/lib/supabase/uploadPdf";
import { fitPdfForUpload } from "@/lib/pdf/shrinkPdf";
import PdfDropInput from "../PdfDropInput";

// 고3 사설 모의고사(0053) 시험 화면의 정답 입력 칸 — 2026-10-11 원장님: 문제지·해설지를 올리고, 정답은 해설지에서 AI가 읽기.
// 막 만든 시험(?new=1)이고 해설지가 있고 정답표가 아직 없으면 AI가 한 번 읽어 표에 채운다(저장은 원장님이 확인 후 "정답표 저장"). 그 밖에는 버튼으로만(2026-10-11).
// 배점·객관식/단답형은 수능 형식으로 정해져 있다(lib/exams/mockCsat.ts csatSpec).

type Part = "공통" | ChoiceKey;

export default function MockCsatPanel({
  code,
  examId,
  hasSolution,
  initial,
  hasKey,
  isAdmin,
  pageMap,
  gradeCuts,
  autoAi = false,
}: {
  code: string;
  examId: string;
  hasSolution: boolean;
  initial: CsatAnswers;
  hasKey: boolean;
  isAdmin: boolean;
  /** 0054 해설지 문항별 풀이 쪽 — 개별 보고서가 틀린 문항의 이 쪽들을 뒤에 붙인다 */
  pageMap: PageMap;
  /** 0055 예상 등급컷(원점수, 선택과목별) — 보고서가 예상 등급을 낸다 */
  gradeCuts: GradeCuts;
  /** 막 만든 시험(?new=1)일 때만 AI(정답 읽기·해설 위치 찾기)를 저절로 돌린다 — 2026-10-11 원장님 "API 쓰지 말고"
   * 이후로는 화면을 열 때마다 돌지 않게, 그 밖에는 버튼으로만 */
  autoAi?: boolean;
}) {
  const router = useRouter();
  const [ans, setAns] = useState<CsatAnswers>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);
  const auto = useRef(false);
  const toCells = (g: GradeCuts) =>
    Object.fromEntries(CHOICES.map((c) => [c.key, Array.from({ length: GRADE_CUT_SLOTS }, (_, i) => (g[c.key]?.[i] != null ? String(g[c.key]![i]) : ""))])) as Record<
      ChoiceKey,
      string[]
    >;
  const [cuts, setCuts] = useState<Record<ChoiceKey, string[]>>(() => toCells(gradeCuts));
  const [cutsDirty, setCutsDirty] = useState(false);
  const [cutsMsg, setCutsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingCuts, startCuts] = useTransition();

  function saveCuts() {
    const clean = cleanGradeCuts(Object.fromEntries(CHOICES.map((c) => [c.key, cuts[c.key]])));
    startCuts(async () => {
      const r = await saveGradeCuts(code, clean);
      if (!r.ok) return setCutsMsg({ ok: false, text: r.msg });
      setCuts(toCells(clean));
      setCutsDirty(false);
      setCutsMsg({ ok: true, text: r.subjects ? `${r.subjects}과목의 예상 등급컷을 저장했습니다. 보고서에 예상 등급이 나옵니다.` : "예상 등급컷을 지웠습니다." });
      router.refresh();
    });
  }

  async function read() {
    setReading(true);
    setMsg({ ok: true, text: "AI가 해설지에서 정답을 읽는 중… (보통 10~40초)" });
    const r = await readMockAnswers(code);
    setReading(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.msg });
      return;
    }
    setAns(r.answers);
    setDirty(true);
    if (Object.keys(r.gradeCuts ?? {}).length) {
      setCuts(toCells(r.gradeCuts));
      setCutsDirty(true);
    }
    setMsg({ ok: true, text: `${r.found}칸을 채웠습니다. 해설지와 한 번 대조한 뒤 "정답표 저장"을 눌러 주세요.` });
  }

  useEffect(() => {
    if (!auto.current && autoAi && isAdmin && hasSolution && !hasKey) {
      auto.current = true;
      void read();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSolution]);

  const set = (part: Part, no: number, v: string) => {
    setAns((prev) => ({ ...prev, [part]: { ...prev[part], [no]: v } }));
    setDirty(true);
  };

  function save() {
    startSave(async () => {
      const r = await saveMockKey(code, ans);
      if (!r.ok) {
        setMsg({ ok: false, text: r.msg });
        return;
      }
      setDirty(false);
      setMsg({
        ok: true,
        text:
          `정답표 ${r.count}문항을 저장했습니다(선택과목: ${r.subjects.map((s) => CHOICES.find((c) => c.key === s)?.name).join(", ")}).` +
          (r.missing.length ? ` 덜 채운 과목은 빼고 저장했어요: ${r.missing.slice(0, 4).join(", ")}${r.missing.length > 4 ? " 외" : ""}.` : "") +
          (r.regraded ? ` 제출 ${r.regraded}건을 다시 채점했습니다.` : ""),
      });
      router.refresh();
    });
  }

  const cell = (part: Part, no: number) => {
    const spec = csatSpec(no, part);
    return (
      <input
        className="input py-0.5 px-1.5 w-14 text-sm text-center tabular-nums"
        value={ans[part]?.[no] ?? ""}
        onChange={(e) => set(part, no, e.target.value)}
        inputMode={spec.type === "객관식" ? "numeric" : "text"}
        aria-label={`${part} ${no}번 정답`}
        placeholder={spec.type === "객관식" ? "1~5" : ""}
      />
    );
  };

  return (
    <div className="card border-indigo-200 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">고3 사설 모의고사 — 해설지·정답</h2>
        <span className="badge bg-indigo-50 text-indigo-700">선택과목: 학생이 제출할 때 고름</span>
      </div>
      <p className="text-sm text-slate-500">
        디지털화·AI 해설 없이 원장님이 올린 <b>문제지</b>와 <b>해설지</b>를 그대로 씁니다. 정답은 해설지에서 AI가 읽어 아래 표에 채우고, 확인한 뒤
        저장하면 학생 제출을 받을 수 있어요(시험 열기는 따로). 배점과 객관식·단답형은 수능 형식(공통 74점 + 선택 26점)입니다.
      </p>

      <SolutionUpload code={code} examId={examId} hasSolution={hasSolution} />
      {hasSolution && <SolutionPages code={code} isAdmin={isAdmin} initial={pageMap} autoAi={autoAi} />}

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <button type="button" className="btn-secondary" disabled={reading || !hasSolution} onClick={read}>
            {reading ? "읽는 중…" : "해설지에서 AI로 정답 읽기"}
          </button>
        )}
        <button type="button" className="btn-primary" disabled={saving || reading} onClick={save}>
          {saving ? "저장하는 중…" : "정답표 저장"}
        </button>
        {dirty && <span className="text-xs text-amber-700">저장하지 않은 변경이 있어요</span>}
      </div>
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium mb-1">공통 (수학Ⅰ·수학Ⅱ) 1~22번</h3>
          <div className="table-wrap">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">번호</th>
                  <th className="py-1 pr-2">정답</th>
                  <th className="py-1 pr-4 text-xs font-normal">배점</th>
                  <th className="py-1 pr-2">번호</th>
                  <th className="py-1 pr-2">정답</th>
                  <th className="py-1 pr-2 text-xs font-normal">배점</th>
                </tr>
              </thead>
              <tbody>
                {COMMON_NOS.slice(0, 11).map((no) => {
                  const no2 = no + 11;
                  return (
                    <tr key={no} className="border-b border-slate-100">
                      <td className="py-1 pr-2 tabular-nums">{no}</td>
                      <td className="py-1 pr-2">{cell("공통", no)}</td>
                      <td className="py-1 pr-4 text-xs text-slate-400">
                        {csatSpec(no, "공통").points}점{csatSpec(no, "공통").type === "주관식" ? " 단답" : ""}
                      </td>
                      <td className="py-1 pr-2 tabular-nums">{no2}</td>
                      <td className="py-1 pr-2">{cell("공통", no2)}</td>
                      <td className="py-1 pr-2 text-xs text-slate-400">
                        {csatSpec(no2, "공통").points}점{csatSpec(no2, "공통").type === "주관식" ? " 단답" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium mb-1">선택과목 23~30번</h3>
          <div className="table-wrap">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">번호</th>
                  {CHOICES.map((c) => (
                    <th key={c.key} className="py-1 pr-2">
                      {c.name}
                    </th>
                  ))}
                  <th className="py-1 pr-2 text-xs font-normal">배점</th>
                </tr>
              </thead>
              <tbody>
                {CHOICE_NOS.map((no) => (
                  <tr key={no} className="border-b border-slate-100">
                    <td className="py-1 pr-2 tabular-nums">{no}</td>
                    {CHOICES.map((c) => (
                      <td key={c.key} className="py-1 pr-2">
                        {cell(c.key, no)}
                      </td>
                    ))}
                    <td className="py-1 pr-2 text-xs text-slate-400">
                      {csatSpec(no, "미적").points}점{csatSpec(no, "미적").type === "주관식" ? " 단답" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-1">해설지에 없는 과목은 비워 두면 그 과목은 학생 화면에서 고를 수 없습니다.</p>
        </div>
      </div>

      {/* 2026-10-11 원장님 "예상 등급컷이 나와 있으면 성적 산출에 반영"(0055) */}
      <div className="rounded-md bg-slate-50 px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">예상 등급컷 (원점수)</span>
          <span className="text-xs text-slate-500">해설지에 실려 있으면 적어 주세요 — 보고서에 학생별 예상 등급이 나옵니다. 없으면 비워 두세요.</span>
        </div>
        <div className="table-wrap">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-3">선택과목</th>
                {Array.from({ length: GRADE_CUT_SLOTS }, (_, i) => (
                  <th key={i} className="py-1 pr-2">
                    {i + 1}등급컷
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CHOICES.map((c) => (
                <tr key={c.key} className="border-b border-slate-100">
                  <td className="py-1 pr-3">{c.name}</td>
                  {cuts[c.key].map((v, i) => (
                    <td key={i} className="py-1 pr-2">
                      <input
                        className="input py-0.5 px-1.5 w-16 text-sm text-center tabular-nums"
                        inputMode="numeric"
                        value={v}
                        aria-label={`${c.name} ${i + 1}등급컷`}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, "");
                          setCuts((prev) => ({ ...prev, [c.key]: prev[c.key].map((x, j) => (j === i ? val : x)) }));
                          setCutsDirty(true);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={savingCuts} onClick={saveCuts}>
            {savingCuts ? "저장하는 중…" : "등급컷 저장"}
          </button>
          {cutsDirty && <span className="text-xs text-amber-700">저장하지 않은 변경이 있어요</span>}
          {cutsMsg && <span className={"text-xs " + (cutsMsg.ok ? "text-emerald-700" : "text-red-600")}>{cutsMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

function SolutionUpload({ code, examId, hasSolution }: { code: string; examId: string; hasSolution: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(!hasSolution);
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">해설지 PDF</span>
        {hasSolution ? (
          <>
            <a href={`/exams/${encodeURIComponent(code)}/solution-pdf`} className="link-accent">
              받기
            </a>
            <button type="button" className="text-xs text-slate-500 underline underline-offset-2" onClick={() => setOpen((v) => !v)}>
              {open ? "닫기" : "다른 파일로 바꾸기"}
            </button>
          </>
        ) : (
          <span className="text-amber-700">아직 없음</span>
        )}
      </div>
      {open && (
        <form
          className="space-y-2"
          action={(fd) => {
            const file = fd.get("pdf");
            if (!(file instanceof File) || file.size === 0) {
              setMsg({ ok: false, text: "해설지 PDF 파일을 선택해 주세요." });
              return;
            }
            start(async () => {
              try {
                const pdf = pdfTooLarge(file) ? (await fitPdfForUpload(file, (m) => setMsg({ ok: true, text: m }))).file : file;
                const path = await uploadSolutionPdfDirect(examId, pdf);
                const r = await finalizeSolutionPdf(code, path);
                if (!r.ok) throw new Error(r.msg);
                setMsg({ ok: true, text: "해설지를 저장했습니다." });
                setOpen(false);
                router.refresh();
              } catch (e: any) {
                setMsg({ ok: false, text: String(e?.message ?? e) });
              }
            });
          }}
        >
          <PdfDropInput name="pdf" required compact />
          <button type="submit" className="btn-secondary" disabled={pending}>
            {pending ? "올리는 중…" : "해설지 PDF 저장"}
          </button>
        </form>
      )}
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}

// 2026-10-11 원장님 "보고서 만들 때 올린 해설에서 틀린 문제 해설을 찾아서 첨부해 줘" — 해설지에서 문항별 풀이 쪽을 AI가 찾아
// 저장해 두면(0054), 개별 보고서가 틀린·무응답 문항의 그 쪽들을 해설지에서 잘라 보고서 뒤에 붙인다. 해설지를 몇 쪽씩 나눠
// 여러 번 부르고(solution-pages 라우트, 동시에 3개), 결과를 buildPageMap으로 모아 저장한다. 틀린 곳은 글로 고칠 수 있다.
function SolutionPages({ code, isAdmin, initial, autoAi }: { code: string; isAdmin: boolean; initial: PageMap; autoAi: boolean }) {
  const router = useRouter();
  const [map, setMap] = useState<PageMap>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState(() => pageMapToText(initial));
  const [saving, startSave] = useTransition();
  const auto = useRef(false);
  const count = Object.keys(map).length;

  async function batch(from: number, to: number): Promise<{ ok: true; pageCount: number; pages: { page: number; items: PageEntry[] }[] } | { ok: false; msg: string }> {
    try {
      const res = await fetch(`/exams/${encodeURIComponent(code)}/solution-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const j = await res.json().catch(() => null);
      if (!j) return { ok: false, msg: `요청 실패(${res.status})` };
      return j;
    } catch (e: any) {
      return { ok: false, msg: String(e?.message ?? e) };
    }
  }

  async function locate() {
    setBusy(true);
    setMsg({ ok: true, text: "AI가 해설지에서 문항별 풀이 쪽을 찾는 중… (1묶음째)" });
    const B = SOLUTION_PAGE_BATCH;
    const first = await batch(1, B);
    if (!first.ok) {
      setBusy(false);
      setMsg({ ok: false, text: "해설 위치를 찾지 못했습니다: " + first.msg });
      return;
    }
    const total = first.pageCount;
    const pages = [...first.pages];
    const ranges: [number, number][] = [];
    for (let f = B + 1; f <= total; f += B) ranges.push([f, Math.min(total, f + B - 1)]);
    const all = ranges.length + 1;
    let done = 1;
    const failed: [number, number][] = [];
    const run = async (list: [number, number][], into: [number, number][]) => {
      let i = 0;
      const worker = async () => {
        while (i < list.length) {
          const [a, b] = list[i++];
          const r = await batch(a, b);
          if (r.ok) {
            pages.push(...r.pages);
            done++;
            setMsg({ ok: true, text: `AI가 해설지에서 문항별 풀이 쪽을 찾는 중… (${done}/${all}묶음)` });
          } else into.push([a, b]);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    };
    await run(ranges, failed);
    const still: [number, number][] = [];
    if (failed.length) await run(failed, still); // 한 번 더
    const next = buildPageMap(pages);
    const r = await saveSolutionPageMap(code, next);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.msg });
      return;
    }
    setMap(next);
    setText(pageMapToText(next));
    setMsg({
      ok: !still.length,
      text:
        `${r.count}문항의 해설 위치를 찾아 저장했습니다(해설지 ${total}쪽).` +
        (still.length ? ` ${still.map(([a, b]) => `${a}~${b}쪽`).join(", ")}은 읽지 못했어요 — 다시 찾기를 누르거나 아래에서 직접 적어 주세요.` : " 아래 목록에서 한 번 확인해 주세요."),
    });
    router.refresh();
  }

  useEffect(() => {
    if (!auto.current && autoAi && isAdmin && count === 0) {
      auto.current = true;
      void locate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveText() {
    const { map: next, errors } = parsePageMapText(text);
    if (errors.length) {
      setMsg({ ok: false, text: "형식이 맞지 않는 줄이 있어요(예: \"3: 12\", \"미적23: 25-26\"): " + errors.slice(0, 3).join(" / ") });
      return;
    }
    startSave(async () => {
      const r = await saveSolutionPageMap(code, next);
      if (!r.ok) return setMsg({ ok: false, text: r.msg });
      setMap(next);
      setMsg({ ok: true, text: `해설 위치 ${r.count}문항을 저장했습니다.` });
      router.refresh();
    });
  }

  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">틀린 문제 해설 첨부</span>
        {count ? <span className="text-emerald-700">{count}문항 위치 저장됨</span> : <span className="text-amber-700">아직 위치를 모름</span>}
        {isAdmin && (
          <button type="button" className="text-xs text-slate-500 underline underline-offset-2" disabled={busy} onClick={locate}>
            {busy ? "찾는 중…" : count ? "AI로 다시 찾기" : "AI로 찾기"}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        개별 보고서를 만들 때, 학생이 틀리거나 비운 문항의 풀이 쪽을 해설지에서 잘라 보고서 뒤에 붙입니다. 쪽 번호는 해설지 PDF의 쪽
        순서(첫 쪽 = 1)입니다.
      </p>
      {msg && <p className={"text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
      <details>
        <summary className="text-xs text-slate-600 cursor-pointer">문항별 쪽 보기·고치기</summary>
        <textarea
          className="input mt-1 font-mono text-xs h-48"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"한 줄에 하나씩\n1: 2\n2: 2-3\n미적23: 25"}
        />
        <button type="button" className="btn-secondary text-xs mt-1" disabled={saving || busy} onClick={saveText}>
          {saving ? "저장하는 중…" : "쪽 목록 저장"}
        </button>
      </details>
    </div>
  );
}
