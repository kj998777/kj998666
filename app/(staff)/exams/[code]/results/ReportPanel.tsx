"use client";

import { useMemo, useState } from "react";
import type { ReportData, ReportStudent } from "./buildReportPdf";

// 채점 결과 화면 위쪽에 붙는 "성적 보고서 만들기" 패널.
// 종합 보고서(반 전체)는 항상 한 개, 개별 보고서는 학생을 골라 한 명씩 PDF로 받거나
// 여러 명을 골라 ZIP으로 한꺼번에 받을 수 있다. 실제 PDF 조립은 buildReportPdf.ts가 한다
// (KaTeX·html2pdf.js를 CDN에서 불러와 브라우저에서 직접 그리므로, 이 버튼을 눌러야 그 도구들을
// 내려받기 시작한다 — 결과 화면을 열 때마다 미리 불러오지 않음).

export default function ReportPanel({ code, examName }: { code: string; examName: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function ensureData(): Promise<ReportData> {
    if (data) return data;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/exams/${encodeURIComponent(code)}/results/report-data`, { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.msg || "데이터를 불러오지 못했습니다.");
      setData(body as ReportData);
      return body as ReportData;
    } finally {
      setLoading(false);
    }
  }

  async function onOpenPanel() {
    try {
      await ensureData();
    } catch (e: any) {
      setMsg("실패: " + (e && e.message ? e.message : String(e)));
    }
  }

  async function onSummary() {
    setBusy(true);
    setMsg("");
    setProgress("시작하는 중…");
    try {
      const d = await ensureData();
      if (!d.students.length) throw new Error("아직 제출한 학생이 없어 종합 보고서를 만들 수 없습니다.");
      const { ensureReportTools, buildSummaryHtml, htmlToPdfBytes, downloadBytes } = await import("./buildReportPdf");
      const { katex } = await ensureReportTools((m) => setProgress(m));
      setProgress("보고서를 그리는 중…");
      const html = buildSummaryHtml(katex, d);
      setProgress("PDF로 만드는 중… (학생 수가 많으면 시간이 걸릴 수 있습니다)");
      const bytes = await htmlToPdfBytes(html);
      downloadBytes(bytes, `${examName}_종합보고서.pdf`);
      setProgress("완료되었습니다.");
    } catch (e: any) {
      setProgress("");
      setMsg("실패: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onIndividual(students: ReportStudent[]) {
    if (!students.length) {
      setMsg("먼저 학생을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const d = await ensureData();
      const { ensureReportTools, buildIndividualHtml, htmlToPdfBytes, downloadBytes, zipAndDownload } = await import("./buildReportPdf");
      const { katex } = await ensureReportTools((m) => setProgress(m));
      if (students.length === 1) {
        const s = students[0];
        setProgress(`${s.student_name} 보고서를 그리는 중…`);
        const html = buildIndividualHtml(katex, d, s);
        setProgress("PDF로 만드는 중…");
        const bytes = await htmlToPdfBytes(html);
        downloadBytes(bytes, `${examName}_${s.class_label}_${s.student_name}.pdf`);
      } else {
        const files: { name: string; bytes: Uint8Array }[] = [];
        for (let i = 0; i < students.length; i++) {
          const s = students[i];
          setProgress(`(${i + 1}/${students.length}) ${s.student_name} 보고서 만드는 중…`);
          const html = buildIndividualHtml(katex, d, s);
          const bytes = await htmlToPdfBytes(html);
          files.push({ name: `${s.class_label}_${s.student_name}.pdf`, bytes });
        }
        setProgress("압축하는 중…");
        await zipAndDownload(files, `${examName}_개별보고서.zip`);
      }
      setProgress("완료되었습니다.");
    } catch (e: any) {
      setProgress("");
      setMsg("실패: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const students = data?.students ?? [];
  const allChecked = students.length > 0 && selected.size === students.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(students.map((s) => s.id)));
  }

  const selectedStudents = useMemo(() => students.filter((s) => selected.has(s.id)), [students, selected]);

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">성적 보고서 만들기</h2>
      <p className="text-sm text-slate-500">
        시험의 정답·해설(영역·난이도·풀이)과 채점 결과를 모아 종합 보고서(반 전체)와 개별 보고서(학생별) PDF를 만듭니다.
        AI가 판단한 난이도이며 실제 정답률이 아니고, 등급·예상 등급은 포함하지 않습니다.
      </p>

      {!data && !loading && (
        <button className="btn-secondary text-sm" onClick={onOpenPanel}>
          불러오기
        </button>
      )}
      {loading && <p className="text-sm text-slate-500">불러오는 중…</p>}

      {data && (
        <div className="space-y-3">
          <div>
            <button className="btn-secondary text-sm px-2 py-1" disabled={busy} onClick={onSummary}>
              종합 보고서 PDF 만들기
            </button>
          </div>

          {students.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm flex items-center gap-1.5">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  전체 선택 ({selected.size}/{students.length})
                </label>
                <div className="flex gap-2">
                  <button className="btn-secondary text-sm px-2 py-1" disabled={busy || selected.size === 0} onClick={() => onIndividual(selectedStudents)}>
                    선택한 학생 개별 보고서 {selected.size > 1 ? "ZIP으로 " : ""}받기
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {students.map((s) => (
                  <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                    <label className="flex items-center gap-1.5 min-w-0">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                      <span className="text-slate-500 shrink-0">{s.class_label}</span>
                      <span className="truncate">{s.student_name}</span>
                    </label>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-400">{s.total_score}점</span>
                      <button className="text-slate-500 hover:underline" disabled={busy} onClick={() => onIndividual([s])}>
                        PDF
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {progress && !msg && <p className="text-sm text-slate-500">{progress}</p>}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
