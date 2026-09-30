// 운영 도구(점검 목록·30일 흐름·정답률 다시 맞추기 계획) 테스트. `tsx test/opsTools.test.ts`
import assert from "node:assert/strict";
import { backupTime, buildHealthChecks, worstLevel, type HealthInput } from "../lib/ops/health";
import { dailyFlow, kstDay, niceMax } from "../lib/ops/flow";
import { planRejudge, type JudgmentRow } from "../lib/ops/rejudgePlan";
import { mcMatchesKeyCell } from "../lib/review/mcAnswer";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok   - ${name}`);
};

const NOW = Date.UTC(2026, 8, 30, 3, 0); // 2026-09-30 12:00 KST
const base: HealthInput = {
  now: NOW,
  adminStage: 0,
  staleSecond: 0,
  pendingEditRequests: 0,
  openBugs: 0,
  waitingAccounts: 0,
  watchTutors: 0,
  pausedTutors: 0,
  lastBackupName: "2026-09-28_0300.json.gz",
  scanMissing: 0,
  noPdf: 0,
};

check("백업 이름 → 시각(한국 시각 기준)", () => {
  assert.equal(backupTime("2026-09-28_0300.json.gz"), Date.UTC(2026, 8, 27, 18, 0));
  assert.equal(backupTime("엉뚱한.json.gz"), null);
  assert.equal(backupTime(null), null);
});

check("모두 괜찮으면 ok", () => {
  const c = buildHealthChecks(base);
  assert.equal(worstLevel(c), "ok");
  assert.ok(c.every((x) => x.level === "ok"), JSON.stringify(c.filter((x) => x.level !== "ok")));
});

check("원장님 판정 1건이면 바로 빨강, 링크 있음", () => {
  const c = buildHealthChecks({ ...base, adminStage: 1 });
  const a = c.find((x) => x.key === "admin")!;
  assert.equal(a.level, "bad");
  assert.equal(a.href, "/admin/review-status");
  assert.equal(worstLevel(c), "bad");
});

check("판정 대기는 적으면 노랑, 20건부터 빨강", () => {
  assert.equal(buildHealthChecks({ ...base, staleSecond: 3 }).find((x) => x.key === "stale")!.level, "warn");
  assert.equal(buildHealthChecks({ ...base, staleSecond: 20 }).find((x) => x.key === "stale")!.level, "bad");
});

check("백업: 없으면 빨강, 9일이면 노랑, 16일이면 빨강", () => {
  const f = (name: string | null) => buildHealthChecks({ ...base, lastBackupName: name }).find((x) => x.key === "backup")!;
  assert.equal(f(null).level, "bad");
  assert.equal(f("2026-09-30_0900.json.gz").value, "오늘");
  assert.equal(f("2026-09-21_1000.json.gz").level, "warn");
  assert.equal(f("2026-09-14_1000.json.gz").level, "bad");
  assert.equal(f("2026-09-25_1000.json.gz").level, "ok");
});

check("정지 선생님이 있으면 빨강, 주의만이면 노랑", () => {
  assert.equal(buildHealthChecks({ ...base, watchTutors: 2 }).find((x) => x.key === "trust")!.level, "warn");
  assert.equal(buildHealthChecks({ ...base, pausedTutors: 1 }).find((x) => x.key === "trust")!.level, "bad");
});

check("한국 날짜: UTC 15시는 다음 날", () => {
  assert.equal(kstDay("2026-09-29T14:59:00Z"), "2026-09-29");
  assert.equal(kstDay("2026-09-29T15:00:00Z"), "2026-09-30");
});

check("30일 흐름: 빈 날 채움·범위 밖 버림·발행/사용 나눔", () => {
  const f = dailyFlow(
    [
      { kind: "primary", created_at: "2026-09-30T01:00:00Z" },
      { kind: "verify", created_at: "2026-09-30T02:00:00Z" },
      { kind: "primary", created_at: "2026-09-29T16:00:00Z" }, // KST 9/30 01시
      { kind: "primary", created_at: "2026-08-01T00:00:00Z" }, // 범위 밖
    ],
    [
      { delta: 3, created_at: "2026-09-30T01:00:00Z" },
      { delta: -50, created_at: "2026-09-30T01:00:00Z" },
      { delta: 2, created_at: "2026-09-02T01:00:00Z" },
    ],
    30,
    NOW
  );
  assert.equal(f.length, 30);
  assert.equal(f[29].day, "2026-09-30");
  assert.equal(f[0].day, "2026-09-01");
  assert.deepEqual(f[29], { day: "2026-09-30", primary: 2, verify: 1, issued: 3, spent: 50 });
  assert.equal(f[1].issued, 2);
  assert.equal(f.reduce((s, d) => s + d.primary, 0), 2);
});

check("눈금 최댓값", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(11), 20);
  assert.equal(niceMax(240), 500);
});

check("정답률 다시 맞추기: 틀림→맞음만, 확정 전은 그대로", () => {
  const rows: JudgmentRow[] = [
    { id: "j1", tutorId: "A", correct: false, source: "majority", kind: "review", refId: "r1" }, // "④" vs 4 → 고침
    { id: "j2", tutorId: "A", correct: false, source: "majority", kind: "review", refId: "r2" }, // 정말 틀림
    { id: "j3", tutorId: "B", correct: true, source: "admin", kind: "review", refId: "r3" }, // 맞음은 안 봄
    { id: "j4", tutorId: "B", correct: false, source: "gold", kind: "gold", refId: "g1" }, // "4번" vs 4 → 고침
    { id: "j5", tutorId: "C", correct: false, source: "majority", kind: "review", refId: "r5" }, // 확정 전
    { id: "j6", tutorId: "C", correct: false, source: "majority", kind: "review", refId: "missing" }, // 정보 없음
  ];
  const info: Record<string, any> = {
    r1: { answer: "④ 12", type: "객관식", keyCell: "4", confirmed: true },
    r2: { answer: "③", type: "객관식", keyCell: "4", confirmed: true },
    r3: { answer: "4", type: "객관식", keyCell: "4", confirmed: true },
    g1: { answer: "4번", type: "객관식", keyCell: "4", confirmed: true },
    r5: { answer: "④", type: "객관식", keyCell: "4", confirmed: false },
  };
  const plan = planRejudge(rows, (r) => info[r.refId] ?? null, (_t, a, k) => mcMatchesKeyCell(a, k) === true);
  assert.equal(plan.checked, 5);
  assert.deepEqual(
    plan.flips.map((f) => f.id),
    ["j1", "j4"]
  );
  assert.equal(plan.skippedUnconfirmed, 1);
  assert.deepEqual(plan.byTutor, { A: 1, B: 1 });
});

console.log(`\n${n}개 통과`);
