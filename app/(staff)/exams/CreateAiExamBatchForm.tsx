"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import PdfDropInput from "./PdfDropInput";
import { createExamRow, finalizeAiExamUpload, type JobPoll } from "./ai-actions";
import { pollJob } from "@/lib/jobPoll";
import { pdfTooLarge, uploadPdfDirect } from "@/lib/supabase/uploadPdf";
import { fitPdfForUpload } from "@/lib/pdf/shrinkPdf";
import { ACTIVE, STAGE_LABEL } from "./aiJobStage";
import { folderLabel, guessFolder } from "@/lib/exams/guessFolder";

type RowStatus = "대기" | "올리는 중…" | "완료" | "실패";

type Row = {
  key: string;
  file: File;
  code: string;
  name: string;
  status: RowStatus;
  msg?: string;
  resultCode?: string; // 성공한 뒤 실제로 만들어진 시험 코드(=code, 진행 화면 폴링용)
};

// 파일 이름에서 확장자를 떼어 시험 코드/이름 기본값으로 쓴다. 같은 이름이 여러 개면 뒤에 -2, -3 …을 붙여
// 배치 안에서라도 코드가 겹치지 않게 한다(그래도 기존 시험과 겹치면 서버가 "이미 사용 중" 오류를 돌려줌 —
// 그건 표에서 코드를 고쳐 그 파일만 다시 시도하면 된다).
function baseNameOf(file: File): string {
  // 2026-09-29: 맥에서 고른 파일 이름은 한글이 분해형(NFD)이라 "제주" 같은 글자 검색이 안 됐다 → 표준형(NFC)으로 바꾼다
  const n = file.name.normalize("NFC").replace(/\.pdf$/i, "").trim();
  return n || "시험";
}

function buildRows(files: File[]): Row[] {
  const used = new Set<string>();
  return files.map((file, i) => {
    let base = baseNameOf(file).slice(0, 40);
    let code = base;
    let n = 2;
    while (used.has(code)) {
      code = (base.slice(0, 40 - String(n).length - 1) + "-" + n).slice(0, 40);
      n++;
    }
    used.add(code);
    return { key: `${i}-${file.name}-${file.size}`, file, code, name: baseNameOf(file).slice(0, 100), status: "대기" };
  });
}

export default function CreateAiExamBatchForm() {
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [isScanned, setIsScanned] = useState(false);
  const sharedRef = useRef<HTMLDivElement | null>(null);

  function readSharedFields(): FormData {
    const fd = new FormData();
    const root = sharedRef.current;
    if (root) {
      const level = root.querySelector<HTMLSelectElement>('[name="school_level"]')?.value ?? "";
      const year = root.querySelector<HTMLInputElement>('[name="folder_year"]')?.value ?? "";
      const grade = root.querySelector<HTMLSelectElement>('[name="folder_grade"]')?.value ?? "";
      const term = root.querySelector<HTMLSelectElement>('[name="folder_term"]')?.value ?? "";
      const kind = root.querySelector<HTMLSelectElement>('[name="folder_kind"]')?.value ?? "";
      fd.set("school_level", level);
      fd.set("folder_year", year);
      fd.set("folder_grade", grade);
      fd.set("folder_term", term);
      fd.set("folder_kind", kind);
    }
    return fd;
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  // #2(2026-09-28): PDF 바이트는 이제 서버 액션이 아니라 브라우저가 Supabase Storage에 곧바로
  // 올린다(lib/supabase/uploadPdf.ts) — Vercel 서버리스 함수의 요청 본문 크기 제한(약 4.5MB, Next.js
  // 설정으로는 못 늘림)을 우회해 50MB까지 지원하기 위함(예전에는 이 제한 때문에 4MB로 막혀 있었고,
  // 넘기면 응답이 undefined로 와서 화면이 "Application error"로 죽는 문제가 있었다 — 2026-09-28
  // 원장님 신고로 발견). 시험 행을 먼저 만들고(createExamRow) → PDF를 직접 올리고(uploadPdfDirect)
  // → 뒷정리(finalizeAiExamUpload) 세 단계로 나뉜다.
  async function submitRow(row: Row) {
    updateRow(row.key, { status: "올리는 중…", msg: undefined });
    // 2026-10-01: 50MB를 넘으면 브라우저에서 자동으로 줄여서 올린다(lib/pdf/shrinkPdf.ts)
    let pdf: Blob = row.file;
    if (pdfTooLarge(row.file)) {
      try {
        pdf = (await fitPdfForUpload(row.file, (m) => updateRow(row.key, { msg: m }))).file;
      } catch (e: any) {
        updateRow(row.key, { status: "실패", msg: String(e?.message ?? e) });
        return;
      }
      updateRow(row.key, { msg: undefined });
    }
    const fd = readSharedFields();
    fd.set("code", row.code);
    fd.set("name", row.name);
    const created = await createExamRow(fd);
    if (!created.ok) {
      updateRow(row.key, { status: "실패", msg: created.msg });
      return;
    }
    try {
      await uploadPdfDirect(created.id, pdf);
    } catch (e: any) {
      updateRow(row.key, {
        status: "실패",
        resultCode: created.code,
        msg: "PDF 업로드 실패(시험은 이미 만들어졌습니다 — 상세 화면에서 다시 올려 주세요): " + String(e?.message ?? e),
      });
      return;
    }
    const r = await finalizeAiExamUpload(created.code, { isScanned, startDigitize: isScanned });
    updateRow(row.key, {
      status: "완료",
      resultCode: created.code,
      msg: r.aiErr ? "AI 처리 시작 실패(상세 화면에서 다시 시도 가능): " + r.aiErr : undefined,
    });
  }

  function runBatch() {
    setRunning(true);
    start(async () => {
      // 한 번에 여러 PDF를 동시에 올리면 몰릴 수 있어, 파일마다 순서대로 하나씩 처리한다.
      // 이미 완료/실패한 행은 건너뛴다(부분 재시도 지원).
      for (const row of rows) {
        if (row.status === "완료") continue;
        await submitRow(row);
      }
      setRunning(false);
    });
  }

  function retryRow(key: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    start(async () => {
      await submitRow(row);
    });
  }

  const doneCodes = useMemo(() => rows.filter((r) => r.status === "완료" && r.resultCode).map((r) => r.resultCode as string), [rows]);

  return (
    <div className="space-y-3">
      <div ref={sharedRef} className="space-y-3">
        <div>
          <label className="label">학교급 (비우면 파일마다 자동)</label>
          <select name="school_level" className="input" defaultValue="" disabled={running}>
            <option value="">선택 안 함</option>
            <option value="중">중학교</option>
            <option value="고">고등학교</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">연도 (비우면 자동)</label>
            <input name="folder_year" className="input" placeholder="2026" disabled={running} />
          </div>
          <div>
            <label className="label">학년</label>
            <select name="folder_grade" className="input" disabled={running}>
              <option value="">선택 안 함</option>
              <option value="1">1학년</option>
              <option value="2">2학년</option>
              <option value="3">3학년</option>
            </select>
          </div>
          <div>
            <label className="label">학기</label>
            <select name="folder_term" className="input" disabled={running}>
              <option value="">선택 안 함</option>
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
          </div>
          <div>
            <label className="label">구분</label>
            <select name="folder_kind" className="input" disabled={running}>
              <option value="">선택 안 함</option>
              <option value="중간">중간고사</option>
              <option value="기말">기말고사</option>
              <option value="기타">기타</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="label">시험지 PDF (여러 개 선택 가능, 50MB가 넘으면 자동으로 줄여서 올림)</label>
        <PdfDropInput multiple disabled={running} onFiles={(files) => setRows(buildRows(files))} />
        <p className="text-xs text-slate-500 mt-1">
          파일마다 시험이 하나씩 따로 만들어집니다. 코드·이름은 파일 이름에서 자동으로 채워지고, <b>폴더(학교급·연도·학년·학기·구분)도
          파일 이름을 읽어 파일마다 자동으로 분류</b>됩니다(아래 표의 &ldquo;자동 분류&rdquo;). 위 칸에서 고른 값이 있으면 그 값이 모든
          파일에 우선 적용됩니다. 코드는 서로 겹치면 안 됩니다.
        </p>
        <label className="flex items-center gap-1.5 text-sm mt-1">
          <input
            type="checkbox"
            checked={isScanned}
            disabled={running}
            onChange={(e) => setIsScanned(e.target.checked)}
          />
          전부 스캔본입니다(디지털화 필요) — 업로드마다 자동으로 디지털화를 시작합니다
        </label>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="border rounded-lg p-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500 truncate max-w-[10rem]" title={row.file.name}>
                {row.file.name}
              </span>
              <input
                className="input !w-32"
                value={row.code}
                onChange={(e) => updateRow(row.key, { code: e.target.value })}
                disabled={row.status === "완료" || row.status === "올리는 중…"}
                placeholder="시험 코드"
              />
              <input
                className="input !w-40"
                value={row.name}
                onChange={(e) => updateRow(row.key, { name: e.target.value })}
                disabled={row.status === "완료" || row.status === "올리는 중…"}
                placeholder="시험 이름"
              />
              <span
                className={
                  "badge " +
                  (row.status === "완료"
                    ? "bg-emerald-100 text-emerald-700"
                    : row.status === "실패"
                    ? "bg-red-100 text-red-700"
                    : row.status === "올리는 중…"
                    ? "bg-sky-100 text-sky-700"
                    : "bg-slate-100 text-slate-600")
                }
              >
                {row.status}
              </span>
              <span className="text-xs text-slate-500" title="파일 이름에서 읽은 폴더 분류">
                자동 분류: {folderLabel(guessFolder(row.name, row.code)) || <span className="text-amber-700">못 읽음(폴더 미분류)</span>}
              </span>
              {row.status === "실패" && (
                <button type="button" className="btn-secondary" disabled={pending} onClick={() => retryRow(row.key)}>
                  이 파일만 다시 시도
                </button>
              )}
              {row.msg && <span className="text-xs text-red-600 basis-full">{row.msg}</span>}
            </div>
          ))}

          <button type="button" className="btn-primary" disabled={running || rows.length === 0} onClick={runBatch}>
            {running ? "올리는 중… (파일마다 순서대로 처리합니다)" : `${rows.length}개 만들고 AI 자동 처리 시작`}
          </button>
        </div>
      )}

      {doneCodes.length > 0 && <BatchAiJobPanel codes={doneCodes} />}
    </div>
  );
}

/** 배치로 만든 시험들의 AI 자동 처리 진행 상황을 한 화면에서 같이 보여준다(AiJobPanel의 여러-개 버전). */
function BatchAiJobPanel({ codes }: { codes: string[] }) {
  const [jobs, setJobs] = useState<Record<string, JobPoll>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 2026-09-29 최적화: fetch로 확인(화면 이동을 막지 않음), 앞선 확인이 끝나기 전에는 새로 부르지 않음
    let busy = false;
    async function tick() {
      if (busy) return;
      busy = true;
      try {
        const entries = await Promise.all(codes.map(async (c) => [c, await pollJob<JobPoll>(c, "ai")] as const));
        if (cancelled) return;
        setJobs((prev) => {
          const next = { ...prev };
          for (const [c, r] of entries) if (r.ok) next[c] = r.data;
          return next;
        });
      } finally {
        busy = false;
      }
    }
    tick();
    timer.current = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join(",")]);

  const anyActive = codes.some((c) => {
    const job = jobs[c];
    return !!job && ACTIVE.has(job.stage);
  });

  return (
    <div className="card border-sky-300 bg-sky-50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sky-900">AI 자동 처리 진행 상황 ({codes.length}개)</h2>
        {anyActive && <span className="text-xs text-sky-700">이 화면을 열어 두는 동안 자동으로 진행됩니다</span>}
      </div>
      <p className="text-xs text-sky-700 mt-1">
        이 화면을 닫으면 진행이 멈춥니다 — 나중에 각 시험 상세 화면을 열어도 이어서 진행됩니다.
      </p>
      <div className="mt-2 space-y-1">
        {codes.map((code) => {
          const job = jobs[code];
          const label = job ? STAGE_LABEL[job.stage] ?? job.stage : "확인 중…";
          return (
            <div key={code} className="flex flex-wrap items-center justify-between text-sm border-t border-sky-100 pt-1 first:border-t-0 first:pt-0 gap-2">
              <Link className="underline" href={`/exams/${encodeURIComponent(code)}`}>
                {code}
              </Link>
              <span className="text-sky-800">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
