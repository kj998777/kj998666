"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { applyDigitizedPdfAsOriginal } from "../../exams/[code]/digitize-actions";
import { uploadPdfDirect } from "@/lib/supabase/uploadPdf";

export type ReplaceRow = { examId: string; code: string; name: string; replaced: boolean; scanOk: boolean; appliedAt: string | null };

// 2026-09-29 원장님 요청: AI 설정에서 "디지털 시험지를 원본으로 적용"(원본 PDF 대체)을 시험마다 들어가지 않고 한 곳에서.
// 조판은 브라우저에서만 되므로(buildDigitizedPdf) 이 화면을 열어 둔 채로 한 시험씩 차례로 만든다.
// 이미 대체한 시험도 "다시 대체"로 새로 만들 수 있다(그림 자리 보정이 좋아졌거나 그림 자리를 직접 고친 뒤).
export default function ReplaceOriginalPanel({ rows }: { rows: ReplaceRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, { ok?: boolean; text: string }>>({});
  const [running, setRunning] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [batch, setBatch] = useState(false);

  const setRow = (id: string, v: { ok?: boolean; text: string }) => setStatus((s) => ({ ...s, [id]: v }));

  async function replaceOne(r: ReplaceRow): Promise<boolean> {
    setRunning(r.examId);
    setRow(r.examId, { text: "시작하는 중…" });
    try {
      const { buildDigitizedPdf } = await import("../../exams/[code]/buildDigitizedPdf");
      const built = await buildDigitizedPdf(r.code, r.name, (m) => setRow(r.examId, { text: m }));
      setRow(r.examId, { text: "새 원본 PDF를 올리는 중…" });
      await uploadPdfDirect(r.examId, new Blob([built.bytes as any], { type: "application/pdf" }));
      setRow(r.examId, { text: "정리하는 중…" });
      const res = await applyDigitizedPdfAsOriginal(r.code, built.locations);
      if (!res.ok) throw new Error(res.msg ?? "대체하지 못했습니다.");
      const warn = [
        built.figErrors ? `그림 오류 ${built.figErrors}곳` : "",
        built.figSuspect?.length ? `그림 확인 필요 ${built.figSuspect.join(", ")}번` : "",
        built.figFixed?.length ? `그림 자리 자동 보정 ${built.figFixed.join(", ")}번` : "",
      ].filter(Boolean);
      setRow(r.examId, { ok: true, text: `대체했습니다 (${built.pages}쪽 · 문항 ${built.items}개 · 그림 ${built.figs}개)` + (warn.length ? " · " + warn.join(" · ") : "") });
      return true;
    } catch (e: any) {
      setRow(r.examId, { ok: false, text: "실패: " + (e?.message || String(e)) });
      return false;
    } finally {
      setRunning(null);
    }
  }

  async function replaceAllPending() {
    stopRef.current = false;
    setBatch(true);
    for (const r of rows.filter((x) => !x.replaced)) {
      if (stopRef.current) break;
      await replaceOne(r);
    }
    setBatch(false);
    router.refresh();
  }

  const pendingRows = rows.filter((r) => !r.replaced);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">원본 PDF를 디지털 시험지로 대체</h2>
        <div className="flex flex-wrap gap-2">
          {batch ? (
            <button className="btn-secondary py-1 px-3 text-xs" onClick={() => (stopRef.current = true)}>
              지금 시험까지만 하고 멈추기
            </button>
          ) : (
            <button className="btn-primary py-1 px-3 text-xs" disabled={!!running || pendingRows.length === 0} onClick={replaceAllPending}>
              아직 대체 안 한 시험 모두 대체 ({pendingRows.length})
            </button>
          )}
          <button className="btn-secondary py-1 px-3 text-xs" disabled={!!running} onClick={() => router.refresh()}>
            새로고침
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        디지털화가 끝난 시험의 원본 PDF를 새로 조판한 디지털 시험지로 바꿉니다(시험 화면의 &ldquo;디지털 시험지를 원본으로 적용&rdquo;과 같음).
        브라우저에서 만들기 때문에 끝날 때까지 이 화면을 열어 두세요. 스캔본은 따로 보관돼 나중에 다시 대체할 수 있습니다.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">디지털화가 끝난 시험이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="w-full min-w-[34rem] sm:min-w-0 text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">시험</th>
                <th className="py-2 pr-2">원본</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = status[r.examId];
                return (
                  <tr key={r.examId} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2">
                      <Link href={`/exams/${encodeURIComponent(r.code)}`} className="hover:underline">
                        {r.name}
                      </Link>
                      {st && <div className={"text-xs mt-0.5 " + (st.ok === false ? "text-red-600" : st.ok ? "text-emerald-700" : "text-slate-500")}>{st.text}</div>}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {r.replaced ? (
                        <span className="badge bg-emerald-100 text-emerald-800 text-xs">대체함</span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-700 text-xs">스캔본</span>
                      )}
                      {r.replaced && !r.scanOk && <div className="text-xs text-amber-700 mt-0.5">스캔본 없음</div>}
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {r.replaced && !r.scanOk ? (
                        <Link href={`/exams/${encodeURIComponent(r.code)}`} className="text-xs text-sky-700 hover:underline">
                          시험 화면에서 스캔본 올리기
                        </Link>
                      ) : (
                        <button
                          className={(r.replaced ? "btn-secondary" : "btn-primary") + " py-1 px-3 text-xs"}
                          disabled={!!running || batch}
                          onClick={async () => {
                            const ok = await replaceOne(r);
                            if (ok) router.refresh();
                          }}
                        >
                          {running === r.examId ? "만드는 중…" : r.replaced ? "다시 대체" : "대체"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
