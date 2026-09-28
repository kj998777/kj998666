import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import StoreFolderTree, { type StoreExam } from "./StoreFolderTree";

// exams_select_tutor_store RLS 정책 덕분에 여기서 select("*")를 해도 "지금 판매 중"이거나
// "이미 구매한" 시험만 자동으로 걸러져서 내려온다 — 앱 코드에서 따로 필터링할 필요 없음.
export default async function TutorStorePage() {
  const session = await requireTutor();
  const supabase = await createClient();

  const [{ data: exams }, { data: purchases }, { data: inReview }] = await Promise.all([
    // status != '검수대기' 로 걸러내는 이유: RLS가 "판매 중이거나 구매한 시험" 외에도
    // "지금 검토 클레임을 갖고 있는 시험"(exams_select_tutor_active_review)이나 "검토 대기중인
    // 모든 시험"(exams_select_tutor_in_review, #111)도 이 테이블 조회에 함께 통과시켜 주므로,
    // 여기서 명시적으로 빼야 검토대기 시험이 구매 버튼과 함께 잘못 섞여 나오지 않는다. 예전에
    // 구매했다가 관리자가 나중에 판매를 중단한(tutor_download_cost를 다시 null로 바꾼) 시험은
    // status가 '닫힘'으로 남아 있으므로 이 필터로도 계속 보이고, 재다운로드도 그대로 된다.
    supabase
      .from("exams")
      .select("id, code, name, tutor_download_cost, school_level, folder_year, folder_grade, folder_term, folder_kind")
      .neq("status", "검수대기")
      .order("name"),
    supabase.from("tutor_exam_purchases").select("exam_id").eq("tutor_id", session.userId),
    // #111: 검토대기(AI 처리/검토 진행 중)인 시험 — exams_select_tutor_in_review RLS로 이름/코드만
    // 노출된다. 아직 못 사는 시험이라는 걸 명확히 하기 위해 판매 목록과 별도 구역에 보여준다.
    supabase.from("exams").select("id, code, name").eq("status", "검수대기").order("name"),
  ]);

  const ownedExamIds = new Set(((purchases as any[]) ?? []).map((p) => p.exam_id));

  // 원본 PDF가 아직 없는 시험(예전 시스템에서 옮겨 온 시험 등)은 사도 받을 게 없으므로 "PDF 준비 중"으로만
  // 보여 주고 구매 버튼을 막는다. 과외선생님은 exam_pdf_meta RLS를 통과하지 못하므로 서비스롤로 "있는지"만 본다.
  const listedIds = ((exams as any[]) ?? []).map((e) => e.id);
  const { data: metaRows } = listedIds.length
    ? await (createAdminClient() as any).from("exam_pdf_meta").select("exam_id").in("exam_id", listedIds)
    : { data: [] };
  const hasPdf = new Set(((metaRows as any[]) ?? []).map((m) => m.exam_id));

  const storeExams: StoreExam[] = ((exams as any[]) ?? []).map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    cost: e.tutor_download_cost ?? null,
    owned: ownedExamIds.has(e.id),
    hasPdf: hasPdf.has(e.id),
    school_level: e.school_level ?? null,
    folder_year: e.folder_year ?? null,
    folder_grade: e.folder_grade ?? null,
    folder_term: e.folder_term ?? null,
    folder_kind: e.folder_kind ?? null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">기출 스토어</h1>
          <p className="text-sm text-slate-500">
            포인트로 기출문제 PDF를 받을 수 있습니다. 한 번 구매하면 다시 받을 때는 포인트가 들지
            않습니다.
          </p>
        </div>
        <Link href="/tutor/store/purchases" className="text-sm link-accent whitespace-nowrap">
          구매 내역 →
        </Link>
      </div>

      <div className="card">
        {((exams as any[]) ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">지금 받을 수 있는 기출문제가 없습니다.</p>
        ) : (
          <StoreFolderTree exams={storeExams} />
        )}
      </div>

      {/* #111: 검토 대기중(AI 처리/검토 진행 중) 시험 안내 — 아직 구매는 못 하지만, 검토가 끝나면
          곧 스토어에 올라온다는 걸 미리 보여준다. 검토를 더 빨리 끝내고 싶은 과외선생님에게는
          "검토하기"로 바로 이동하는 링크도 함께 준다. */}
      {((inReview as any[]) ?? []).length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium mb-2">검토 대기중</h2>
          <p className="text-xs text-slate-500 mb-2">
            아직 검토가 끝나지 않아 구매할 수 없는 시험입니다. 검토가 완료되면 스토어에 올라옵니다.
          </p>
          <ul className="text-sm divide-y divide-slate-100">
            {(inReview as any[]).map((e) => (
              <li key={e.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                <span>
                  {e.name} <span className="text-slate-400">({e.code})</span>
                </span>
                <span className="text-xs text-slate-400 whitespace-nowrap">검토 진행 중</span>
              </li>
            ))}
          </ul>
          <Link href="/tutor/review" className="text-sm link-accent inline-block mt-2">
            검토하러 가기 →
          </Link>
        </div>
      )}
    </div>
  );
}

