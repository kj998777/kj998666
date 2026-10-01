import Link from "next/link";
import CopyLink from "@/app/(tutor)/tutor/store/[code]/results/CopyLink";
import ContentKindBadge from "@/app/(tutor)/tutor/store/ContentKindBadge";
import type { BankDetail } from "@/lib/bank/load";
import type { PlacementSubmissionRow, PlacementTest } from "@/lib/placement/server";
import { PlacementOpenToggle, PlacementPdfButtons, PlacementReportButton } from "./PlacementTools";

// 입학테스트(0047) 목록·자세히 화면 — 학원(/placement)·과외선생님(/tutor/placement)이 같이 쓴다.

const LEVEL_CLS: Record<string, string> = {
  기초: "bg-amber-100 text-amber-800",
  표준: "bg-sky-100 text-sky-800",
  심화: "bg-violet-100 text-violet-800",
};

export function PlacementList({ tests, counts, base }: { tests: PlacementTest[]; counts: Record<string, number>; base: string }) {
  if (!tests.length) return null;
  return (
    <div className="card space-y-1">
      <h2 className="font-medium text-sm">만든 입학테스트</h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {tests.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <Link href={`${base}/${t.id}`} className="link-accent font-medium">
                {t.title || "입학테스트"}
              </Link>
              <span className="ml-2 text-xs text-slate-400">
                {t.scope_label} · {t.item_ids.length}문항 · {new Date(t.created_at).toLocaleDateString("ko-KR")}
              </span>
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap">
              제출 {counts[t.id] ?? 0}명{t.is_open ? "" : " · 닫힘"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlacementDetailView({
  test,
  details,
  submissions,
  canToggle,
  backHref,
}: {
  test: PlacementTest;
  details: BankDetail[];
  submissions: PlacementSubmissionRow[];
  canToggle: boolean;
  backHref: string;
}) {
  const avg = submissions.length ? Math.round((submissions.reduce((a, s) => a + s.diag.score, 0) / submissions.length) * 10) / 10 : null;
  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm link-accent">
        ← 입학테스트
      </Link>
      <div className="card space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{test.title || "입학테스트"}</h1>
          <span className={"badge " + (test.is_open ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600")}>
            {test.is_open ? "제출 받는 중" : "제출 닫힘"}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {test.scope_label} · {details.length}문항 · 100점 만점 · {new Date(test.created_at).toLocaleString("ko-KR")}에 만듦
          {test.points_spent > 0 ? ` · ${test.points_spent}P` : ""}
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">시험지·정답지 받기</h2>
        <p className="text-sm text-slate-500">
          시험지는 원래 기출 시험지에서 문항 자리를 오려 붙이고(쉬운 문항부터), <b>맨 뒤 쪽에 답 제출 QR</b>이 붙습니다. 학생이 다 풀고 QR을 찍어
          답을 내면 바로 채점돼 아래 &ldquo;제출한 학생&rdquo;에 올라옵니다.
        </p>
        <p className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
          <span>시험지</span>
          <ContentKindBadge kind="original" />
          <span>· 정답·해설지·진단 보고서</span>
          <ContentKindBadge kind="medic" />
        </p>
        <PlacementPdfButtons id={test.id} code={test.code} title={test.title} scope={test.scope_label} />
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">학생 답 제출 링크</h2>
        <p className="text-sm text-slate-500">QR 대신 링크로 보낼 때 쓰세요. 로그인 없이 이름과 답만 적으면 됩니다.</p>
        <CopyLink path={`/p/${test.code}`} />
        {canToggle && (
          <div className="pt-1">
            <PlacementOpenToggle id={test.id} open={test.is_open} />
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">
          제출한 학생 {submissions.length}명{avg !== null ? ` · 평균 ${avg}점` : ""}
        </h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-slate-500">아직 제출한 학생이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">이름</th>
                  <th className="py-2 pr-2">점수</th>
                  <th className="py-2 pr-2">실질 점수</th>
                  <th className="py-2 pr-2">추천 단계</th>
                  <th className="py-2 pr-2">놓친 단원</th>
                  <th className="py-2 pr-2">보고서</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2 font-medium whitespace-nowrap">
                      {s.student_name}
                      <div className="text-xs font-normal text-slate-400">{new Date(s.created_at).toLocaleString("ko-KR")}</div>
                    </td>
                    <td className="py-2 pr-2">{s.diag.score}</td>
                    <td className={"py-2 pr-2 " + (s.diag.realScore < s.diag.score ? "text-amber-700 font-medium" : "")}>{s.diag.realScore}</td>
                    <td className="py-2 pr-2">
                      <span className={"badge " + (LEVEL_CLS[s.diag.level] ?? "")}>{s.diag.level}</span>
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-600 min-w-[8rem]">{s.diag.weakUnits.slice(0, 3).join(", ") || "없음"}</td>
                    <td className="py-2 pr-2">
                      <PlacementReportButton
                        id={test.id}
                        title={test.title}
                        scope={test.scope_label}
                        student={{ name: s.student_name, perItem: s.per_item, createdAt: s.created_at }}
                        promo={test.owner_kind === "staff"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400">
          추천 단계(참고) — 심화: 실질 점수 80점 이상이고 어려운 문항(중상·상)의 절반 이상을 맞힘 · 표준: 50점 이상 · 기초: 그 밖. 실질 점수는 찍어서 맞힌
          문항을 뺀 점수입니다.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">문항</h2>
        <ol className="divide-y divide-slate-100 text-sm">
          {details.map((d, i) => (
            <li key={d.id + i} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="w-6 text-right font-semibold">{i + 1}</span>
              <span className="badge bg-slate-100 text-slate-700">{d.difficulty}</span>
              <span>{d.unit || d.area || "단원 미상"}</span>
              <span className="text-xs text-slate-400">
                {d.examName.replace(/_/g, " ")} {d.label}번 · {d.type} · {d.points}점
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
