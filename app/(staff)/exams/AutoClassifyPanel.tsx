"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { autoClassifyExams } from "./actions";
import { actionErrorMessage } from "@/lib/actionError";

// 2026-10-03: 미분류 시험 자동 정리(관리자). 시험 이름(=파일 이름)·코드에서 학교급·연도·학년·학기·중간/기말을 읽어
// 비어 있는 칸만 채운다(lib/exams/guessFolder.ts). 새로 올리는 시험은 업로드할 때 같은 방법으로 자동 분류된다.
export default function AutoClassifyPanel({ unfiled }: { unfiled: number }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Awaited<ReturnType<typeof autoClassifyExams>> | null>(null);
  const [err, setErr] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">폴더 자동 분류</h2>
          <p className="text-sm text-slate-500">
            시험 이름을 읽어 학교급·연도·학년·학기·중간/기말 중 <b>비어 있는 칸만</b> 채웁니다(예: &ldquo;휘문고등학교 1학년 2025년 2학기
            공통수학2 중간&rdquo; → 고 · 2025 · 1학년 · 2학기 · 중간). 직접 고른 분류는 바꾸지 않습니다. 새로 올리는 시험은 업로드할 때
            자동으로 분류됩니다. 지금 폴더 미분류: <b>{unfiled}개</b>
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr("");
              try {
                setRes(await autoClassifyExams());
              } catch (e) {
                setErr(actionErrorMessage(e).text);
              }
            })
          }
        >
          {pending ? "분류하는 중…" : "미분류 자동 정리"}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {res && !res.ok && <p className="text-sm text-red-600">{res.msg}</p>}
      {res && res.ok && (
        <div className="space-y-2 text-sm">
          <p className="text-emerald-700">
            {res.changed.length ? `${res.changed.length}개 시험의 빈 칸을 채웠습니다.` : "새로 채운 시험은 없습니다."}
          </p>
          {res.changed.length > 0 && (
            <ul className="text-slate-600 space-y-0.5">
              {res.changed.map((e) => (
                <li key={e.code}>
                  {e.name} → <b>{e.label}</b>
                </li>
              ))}
            </ul>
          )}
          {res.remaining.length > 0 && (
            <details open={res.remaining.length <= 20}>
              <summary className="cursor-pointer text-slate-600">
                이름만으로는 다 못 채운 시험 {res.remaining.length}개 — 눌러서 시험 상세에서 직접 골라 주세요
              </summary>
              <ul className="mt-1 space-y-0.5">
                {res.remaining.map((e) => (
                  <li key={e.code}>
                    <Link href={`/exams/${encodeURIComponent(e.code)}`} className="link-accent">
                      {e.name}
                    </Link>{" "}
                    <span className="text-slate-400">(빈 칸: {e.missing})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
