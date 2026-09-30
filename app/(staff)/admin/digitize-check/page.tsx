import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { loadDigitizeSuspects } from "@/lib/digitize/suspectLoad";
import OkButton from "./OkButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 디지털화 점검(2026-09-30 원장님 요청 — 숫자를 잘못 옮겨 적은 문항을 한 문항씩 찾지 않아도 되게).
// 같은 스캔본을 AI가 따로 두 번 읽은 결과(처음 자동 처리의 문제 요약·풀이·정답 / 디지털화 글)를 맞대 보고 숫자가 어긋나는 문항을 모은다.
export default async function DigitizeCheckPage({ searchParams }: { searchParams?: { exam?: string } }) {
  await requireRole("admin");
  const supabase = await createClient();
  const { rows, examsChecked, itemsChecked } = await loadDigitizeSuspects(supabase);
  const exams = Array.from(new Map(rows.map((r) => [r.code, r.examName])).entries()).sort((a, b) => a[1].localeCompare(b[1], "ko"));
  const pick = searchParams?.exam && exams.some(([c]) => c === searchParams.exam) ? searchParams.exam : "";
  const shown = pick ? rows.filter((r) => r.code === pick) : rows;
  const strong = rows.filter((r) => r.score >= 3).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">디지털화 점검</h1>
        <p className="text-sm text-slate-500">
          디지털화한 시험 {examsChecked}개의 문항 {itemsChecked}개를 살펴, 옮겨 적은 글의 숫자가 처음 AI가 읽은 문제 요약·풀이·정답과 어긋나는 문항{" "}
          <b>{rows.length}개</b>(강한 의심 {strong}개)를 찾았습니다. 둘 중 어느 쪽이 틀렸는지는 원본을 보고 판단해 주세요 — 옮겨 적은 글이 틀렸으면{" "}
          &ldquo;고치러 가기&rdquo;에서 그 문제만 AI로 다시 읽거나 직접 고치고, 맞으면 &ldquo;문제없음&rdquo;을 누르면 목록에서 빠집니다(글이 다시 바뀌면 다시 살핍니다).
        </p>
      </div>

      {exams.length > 1 && (
        <div className="flex flex-wrap gap-1 text-sm">
          <Link href="/admin/digitize-check" className={"badge " + (!pick ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700")}>
            전체 {rows.length}
          </Link>
          {exams.map(([c, name]) => (
            <Link
              key={c}
              href={`/admin/digitize-check?exam=${encodeURIComponent(c)}`}
              className={"badge " + (pick === c ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700")}
            >
              {name.replace(/_/g, " ")} {rows.filter((r) => r.code === c).length}
            </Link>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card text-sm text-slate-500">의심되는 문항이 없습니다.</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={`${r.code}-${r.pageNo}-${r.itemIndex}`} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={"badge " + (r.score >= 3 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")}>
                    {r.score >= 3 ? "강한 의심" : "확인 필요"}
                  </span>
                  <b>
                    {r.examName.replace(/_/g, " ")} · {r.label}번
                  </b>
                  <span className="text-xs text-slate-400">{r.pageNo}쪽</span>
                  {r.edited && <span className="badge bg-emerald-100 text-emerald-700">{r.edited === "ai" ? "AI로 다시 읽음" : "직접 고침"}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {r.itemId ? (
                    <Link href={`/admin/review-status/item/${r.itemId}?fix=1`} className="btn-secondary py-1 px-3 text-sm">
                      고치러 가기
                    </Link>
                  ) : (
                    <Link href={`/exams/${encodeURIComponent(r.code)}`} className="btn-secondary py-1 px-3 text-sm" title="시험 화면의 '문제 글 고치기'에서 고칩니다">
                      시험 화면에서 고치기
                    </Link>
                  )}
                  <OkButton code={r.code} pageNo={r.pageNo} itemIndex={r.itemIndex} />
                </div>
              </div>
              <ul className="text-sm text-slate-700 list-disc pl-5 space-y-0.5">
                {r.reasons.map((x, i) => (
                  <li key={i}>{x.text}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
