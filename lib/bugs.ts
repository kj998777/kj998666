// 과외선생님 버그 신고(0026 bug_reports) 공용 값. 과외 화면·관리자 화면·서버 액션이 함께 쓴다.

export const BUG_CATEGORIES = ["화면·기능 오류", "문제·해설 오류", "포인트·구매", "기타"] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

export const BUG_STATUSES = ["접수", "확인 중", "해결", "보류"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_STATUS_BADGE: Record<string, string> = {
  접수: "bg-amber-100 text-amber-800",
  "확인 중": "bg-sky-100 text-sky-700",
  해결: "bg-emerald-100 text-emerald-700",
  보류: "bg-slate-100 text-slate-600",
};

/** 스크린샷 저장 위치: 과외 풀이 사진과 같은 비공개 버킷의 bugs/ 아래 */
export const BUG_PHOTO_BUCKET = "tutor-review-photos";

/** 한 사람이 하루(24시간)에 보낼 수 있는 신고 수 — 실수로 여러 번 누르거나 남용하는 것 방지 */
export const BUG_DAILY_LIMIT = 10;

export type BugReport = {
  id: string;
  reporter_id: string;
  category: string;
  title: string;
  body: string;
  page_hint: string | null;
  user_agent: string | null;
  photo_path: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

/** 0026을 아직 실행하지 않아 표가 없을 때의 오류인지 */
export function isMissingTable(err: any): boolean {
  const m = String(err?.message ?? err ?? "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /bug_reports/.test(m) && /(does not exist|schema cache|Could not find)/i.test(m);
}
