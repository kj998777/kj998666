"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHOICES, CHOICE_NOS, COMMON_NOS, csatSpec, type ChoiceKey, type CsatAnswers } from "@/lib/exams/mockCsat";
import { finalizeSolutionPdf, readMockAnswers, saveMockKey } from "../mock-actions";
import { pdfTooLarge, uploadSolutionPdfDirect } from "@/lib/supabase/uploadPdf";
import { fitPdfForUpload } from "@/lib/pdf/shrinkPdf";
import PdfDropInput from "../PdfDropInput";

// 고3 사설 모의고사(0053) 시험 화면의 정답 입력 칸 — 2026-10-11 원장님: 문제지·해설지를 올리고, 정답은 해설지에서 AI가 읽기.
// 해설지가 있고 정답표가 아직 없으면 화면을 열 때 AI가 한 번 읽어 표에 채운다(저장은 원장님이 확인 후 "정답표 저장").
// 배점·객관식/단답형은 수능 형식으로 정해져 있다(lib/exams/mockCsat.ts csatSpec).

type Part = "공통" | ChoiceKey;

export default function MockCsatPanel({
  code,
  examId,
  hasSolution,
  initial,
  hasKey,
  isAdmin,
}: {
  code: string;
  examId: string;
  hasSolution: boolean;
  initial: CsatAnswers;
  hasKey: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [ans, setAns] = useState<CsatAnswers>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);
  const auto = useRef(false);

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
    setMsg({ ok: true, text: `${r.found}칸을 채웠습니다. 해설지와 한 번 대조한 뒤 "정답표 저장"을 눌러 주세요.` });
  }

  useEffect(() => {
    if (!auto.current && isAdmin && hasSolution && !hasKey) {
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
