"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { retagJejuExams } from "./actions";
import { actionErrorMessage } from "@/lib/actionError";

// 2026-09-29: 제주 학교 자동분류 다시 하기(관리자). 넓힌 규칙으로 모든 시험을 다시 판정하고, 여전히 "타 지역"으로
// 남은 시험 이름을 보여 준다 — 그중 실제 제주 학교가 있으면 시험 상세의 "제주도 내 학교 시험"을 체크하면 된다.
export default function JejuRetagPanel() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Awaited<ReturnType<typeof retagJejuExams>> | null>(null);
  const [err, setErr] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">제주 학교 자동 분류</h2>
          <p className="text-sm text-slate-500">
            시험 이름으로 제주 학교를 다시 판정합니다(&ldquo;일고&rdquo;·&ldquo;중앙여고&rdquo;·&ldquo;사대부고&rdquo;처럼 줄여 쓴 이름,
            &ldquo;남녕 1-1&rdquo;처럼 고·중을 뺀 이름도 인식). 제주로 켜기만 하고, 직접 바꾼 표시는 끄지 않습니다.
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr("");
              try {
                setRes(await retagJejuExams());
              } catch (e) {
                setErr(actionErrorMessage(e).text);
              }
            })
          }
        >
          {pending ? "판정하는 중…" : "지금 다시 판정"}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {res && !res.ok && <p className="text-sm text-red-600">{res.msg}</p>}
      {res && res.ok && (
        <div className="space-y-2 text-sm">
          <p className="text-emerald-700">
            {res.changed.length ? `${res.changed.length}개 시험을 제주 학교로 표시했습니다.` : "새로 제주로 바뀐 시험은 없습니다."}
          </p>
          {res.changed.length > 0 && (
            <p className="text-slate-600">{res.changed.map((e) => e.name).join(" · ")}</p>
          )}
          <details open={res.remaining.length > 0 && res.remaining.length <= 30}>
            <summary className="cursor-pointer text-slate-600">
              여전히 타 지역으로 남은 시험 {res.remaining.length}개 — 제주 학교가 섞여 있으면 눌러서 직접 체크해 주세요
            </summary>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {res.remaining.map((e) => (
                <li key={e.code}>
                  <Link href={`/exams/${encodeURIComponent(e.code)}`} className="link-accent">
                    {e.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
