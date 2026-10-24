// 모의고사 탭(2026-10-24 사용자 요청 "모의고사만 볼 수 있도록 모은 탭 — 사설과 평가원 폴더를 나눠서").
// 시험 목록(ExamFolderTree)과 기출 스토어(StoreFolderTree)가 함께 쓰는 순수 함수(test/mockSource.test.ts).
// 모의고사 = folder_kind '모의고사'(0056). 출처는 시험 이름으로 나눈다:
//   평가원: "모의평가"·"대학수학능력시험"·"평가원"이 들어가거나 "N학년도 수능"
//   교육청: "학력평가"·"학평"·"교육청" (아직 없지만 생기면 따로 폴더)
//   사설:   나머지(이해원·킬링캠프 등)

export type MockSource = "평가원" | "교육청" | "사설";
export const MOCK_SOURCES: MockSource[] = ["평가원", "교육청", "사설"];

const clean = (s: string) => String(s ?? "").normalize("NFC");

export function isMockExam(e: { folder_kind?: string | null; mock_csat?: boolean | null }): boolean {
  return e.folder_kind === "모의고사" || e.mock_csat === true;
}

export function mockSource(name: string): MockSource {
  const s = clean(name);
  if (/모의평가|대학수학능력시험|평가원|20\d{2}\s*학년도\s*수능|모평/.test(s)) return "평가원";
  if (/학력평가|학평|교육청/.test(s)) return "교육청";
  return "사설";
}

/**
 * 출처 폴더 안의 연도 폴더 이름.
 * 평가원·사설은 수능 학년도("2027학년도"): 이름의 "N학년도", 없으면 이름의 따로 떨어진 20xx(사설 "2027 이해원 …"),
 * 그것도 없으면 폴더 연도 + 1. 교육청은 치른 해("2026년"): 이름의 "N년", 없으면 폴더 연도.
 */
export function mockYearLabel(e: { name: string; folder_year?: string | null }, source: MockSource = mockSource(e.name)): string {
  const s = clean(e.name);
  if (source === "교육청") {
    const y = s.match(/(20\d{2})\s*년/)?.[1] ?? e.folder_year ?? null;
    return y ? `${y}년` : "연도 미지정";
  }
  const hy = s.match(/(20\d{2})\s*학년도/)?.[1] ?? s.match(/(?:^|[^0-9])(20\d{2})(?![0-9]|\s*년)/)?.[1] ?? null;
  if (hy) return `${hy}학년도`;
  const fy = Number(e.folder_year);
  return Number.isFinite(fy) && fy > 2000 ? `${fy + 1}학년도` : "연도 미지정";
}

/** 같은 연도 폴더 안의 순서: 달(3월 … 10월) → 수능은 맨 뒤 → 회차(0회, 1회 …) → 이름 */
export function mockSortKey(name: string): [number, number, string] {
  const s = clean(name);
  const month = /수능|대학수학능력시험/.test(s) && !/모의평가/.test(s) ? 13 : Number(s.match(/(\d{1,2})\s*월/)?.[1] ?? 0);
  const round = Number(s.match(/(\d{1,3})\s*회/)?.[1] ?? -1);
  return [month, round, s];
}

export function compareMock(a: { name: string }, b: { name: string }): number {
  const [m1, r1, s1] = mockSortKey(a.name);
  const [m2, r2, s2] = mockSortKey(b.name);
  return m1 - m2 || s1.replace(/\d+\s*회.*$/, "").localeCompare(s2.replace(/\d+\s*회.*$/, ""), "ko") || r1 - r2 || s1.localeCompare(s2, "ko");
}

export type MockGroup<T> = { source: MockSource; years: { label: string; exams: T[] }[]; count: number };

/** 모의고사만 골라 출처 → 연도(최근 먼저) → 회차 순으로 묶는다. 빈 출처는 뺀다(평가원·사설은 항상 보이게 할지는 화면이 정함). */
export function groupMocks<T extends { name: string; folder_year?: string | null; folder_kind?: string | null }>(exams: T[]): MockGroup<T>[] {
  const out: MockGroup<T>[] = [];
  for (const source of MOCK_SOURCES) {
    const list = exams.filter((e) => isMockExam(e) && mockSource(e.name) === source);
    const byYear = new Map<string, T[]>();
    for (const e of list) {
      const k = mockYearLabel(e, source);
      byYear.set(k, [...(byYear.get(k) ?? []), e]);
    }
    const years = Array.from(byYear.entries())
      .sort((a, b) => (a[0] === "연도 미지정" ? 1 : b[0] === "연도 미지정" ? -1 : b[0].localeCompare(a[0])))
      .map(([label, xs]) => ({ label, exams: [...xs].sort(compareMock) }));
    out.push({ source, years, count: list.length });
  }
  return out;
}

/**
 * 시험지 앞 표지의 큰 제목·옆 상자(lib/ai/canvasStamp.ts renderCoverPng) — 2026-10-24 사용자
 * "표지 넣을 때 내신기출이 아니라 사설은 사설 모의고사, 평가원은 모의고사 기출로".
 * 모의고사가 아니면 undefined(기본 "내신 기출 문제지 · 내신 대비" 그대로).
 */
export function mockCoverStyle(e: { name: string; folder_kind?: string | null; mock_csat?: boolean | null }): { title: string; badge: string } | undefined {
  if (!isMockExam(e)) return undefined;
  return { title: mockSource(e.name) === "사설" ? "사설 모의고사" : "모의고사 기출", badge: "수능 대비" };
}
