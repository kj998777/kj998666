// 운영 점검(2026-09-30) — 운영 현황 화면 맨 위 "지금 손봐야 할 것" 목록. 숫자를 모아 오는 것은 화면(page.tsx)이 하고,
// 여기서는 그 숫자로 항목·색·안내 문구만 정한다(DB 없이 시험할 수 있게).

export type HealthLevel = "ok" | "warn" | "bad";
export type HealthCheck = { key: string; label: string; level: HealthLevel; value: string; hint: string; href?: string };

export type HealthInput = {
  now: number;
  adminStage: number; // 셋 다 달라 원장님 판정이 필요한 문항
  staleSecond: number; // 판정(두 번째 선생님)을 3일 넘게 기다리는 문항
  pendingEditRequests: number; // 과외선생님 수정 요청 대기
  openBugs: number; // 버그 신고 접수(처리 전)
  waitingAccounts: number; // 승인 대기 계정
  watchTutors: number; // 신뢰도 "주의"
  pausedTutors: number; // 신뢰도 "정지"
  lastBackupName: string | null; // 예: 2026-09-28_1430.json.gz (한국 시각)
  scanMissing: number; // 원본으로 적용하면서 스캔본이 지워진 시험(디지털화 다시 손보려면 스캔본 필요)
  noPdf: number; // 문항은 있는데 원본 PDF가 없는 시험(문항 은행 시험지가 글로만 나감)
};

export const STALE_SECOND_DAYS = 3;
export const BACKUP_WARN_DAYS = 8; // 자동 백업이 7일마다라 하루 여유
export const BACKUP_BAD_DAYS = 15;

/** 백업 파일 이름(한국 시각) → UTC 밀리초. 모양이 다르면 null. */
export function backupTime(name: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(String(name ?? ""));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]);
  return Number.isFinite(t) ? t : null;
}

function countCheck(key: string, label: string, n: number, badAt: number, hint: string, href?: string): HealthCheck {
  return { key, label, value: `${n}`, level: n <= 0 ? "ok" : n >= badAt ? "bad" : "warn", hint: n <= 0 ? "없음" : hint, href };
}

export function buildHealthChecks(x: HealthInput): HealthCheck[] {
  const out: HealthCheck[] = [];
  out.push(countCheck("admin", "원장님 판정 필요", x.adminStage, 1, "셋 다 답이 달라 원장님이 정해야 합니다", "/admin/review-status"));
  out.push(
    countCheck(
      "stale",
      `판정 ${STALE_SECOND_DAYS}일+ 대기`,
      x.staleSecond,
      20,
      "판정할 수 있는 선생님(검증됨·우수)이 부족하면 쌓입니다 — 직접 확정하거나 선생님을 늘려 주세요",
      "/admin/review-status"
    )
  );
  out.push(countCheck("edit", "수정 요청 대기", x.pendingEditRequests, 10, "과외선생님이 보낸 해설·정답 수정 요청", "/admin/review-status"));
  out.push(countCheck("bugs", "새 버그 신고", x.openBugs, 5, "접수·확인 중인 신고", "/admin/bug-reports"));
  out.push(countCheck("accounts", "승인 대기 계정", x.waitingAccounts, 5, "계정 관리에서 역할을 정해 주세요", "/admin/users"));
  const risky = x.watchTutors + x.pausedTutors;
  out.push({
    key: "trust",
    label: "주의·정지 선생님",
    value: `${risky}`,
    level: risky <= 0 ? "ok" : x.pausedTutors > 0 ? "bad" : "warn",
    hint: risky <= 0 ? "없음" : `주의 ${x.watchTutors}명 · 정지 ${x.pausedTutors}명 — 아래 표에서 정답률을 확인하세요`,
  });
  const bt = backupTime(x.lastBackupName);
  if (bt === null) {
    out.push({ key: "backup", label: "마지막 백업", value: "없음", level: "bad", hint: "“지금 백업”을 한 번 눌러 주세요(이후 자동)" });
  } else {
    const days = Math.floor((x.now - bt) / 86400000);
    out.push({
      key: "backup",
      label: "마지막 백업",
      value: days <= 0 ? "오늘" : `${days}일 전`,
      level: days >= BACKUP_BAD_DAYS ? "bad" : days >= BACKUP_WARN_DAYS ? "warn" : "ok",
      hint: days >= BACKUP_WARN_DAYS ? "자동 백업이 멈춘 것 같습니다 — “지금 백업”을 눌러 보세요" : "7일마다 자동",
    });
  }
  out.push(countCheck("scan", "스캔본 없는 시험", x.scanMissing, 99, "디지털화를 다시 손보려면 처음 스캔 PDF를 다시 올려야 합니다"));
  out.push(countCheck("nopdf", "원본 PDF 없는 시험", x.noPdf, 99, "문항 은행 시험지에서 이 시험 문항은 옮겨 적은 글로만 나갑니다"));
  return out;
}

/** 항목들 중 가장 나쁜 단계 */
export function worstLevel(checks: HealthCheck[]): HealthLevel {
  if (checks.some((c) => c.level === "bad")) return "bad";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}
