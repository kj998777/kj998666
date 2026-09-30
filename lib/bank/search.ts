// 문항 은행(2026-09-30): 모든 시험의 문항을 단원·난이도·학교·글자로 찾는 순수 계산. 화면(서버)과 테스트가 같이 쓴다.

export type BankItem = {
  id: string;
  examId: string;
  examCode: string;
  examName: string;
  examStatus: string;
  schoolLevel: string | null; // 초·중·고
  grade: number | null;
  year: string | null;
  isJeju: boolean;
  label: string;
  sortOrder: number;
  area: string;
  unit: string;
  difficulty: string;
  type: "객관식" | "주관식" | "";
  statement: string;
  answerDisplay: string;
  correctAnswers: string;
  points: number;
  /** 정답이 확정됐는가(검토 끝났거나, 검토 단계를 거치지 않은 열린·닫힌 시험) */
  confirmed: boolean;
  hasLocation: boolean;
};

export type BankFilter = {
  q?: string; // 문제 글·단원·시험 이름에서 찾기(띄어쓰기 무시)
  level?: string; // 초·중·고
  grade?: string; // "1"~"6"
  year?: string;
  area?: string;
  unit?: string; // 부분 일치
  diff?: string[]; // 하·중하·중·중상·상
  type?: string; // 객관식·주관식
  school?: string; // 시험 이름 부분 일치
  jeju?: boolean;
  all?: boolean; // 확정 안 된 문항도
};

export const DIFFS = ["하", "중하", "중", "중상", "상"];

const squash = (s: string) => String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

export function parseFilter(sp: Record<string, string | string[] | undefined>): BankFilter {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const diffRaw = sp.diff;
  const diff = (Array.isArray(diffRaw) ? diffRaw : diffRaw ? String(diffRaw).split(",") : []).filter((d) => DIFFS.includes(d));
  return {
    q: one("q")?.slice(0, 100),
    level: ["초", "중", "고"].includes(one("level") ?? "") ? one("level") : undefined,
    grade: /^[1-6]$/.test(one("grade") ?? "") ? one("grade") : undefined,
    year: /^20\d{2}$/.test(one("year") ?? "") ? one("year") : undefined,
    area: one("area")?.slice(0, 60),
    unit: one("unit")?.slice(0, 60),
    diff: diff.length ? diff : undefined,
    type: ["객관식", "주관식"].includes(one("type") ?? "") ? one("type") : undefined,
    school: one("school")?.slice(0, 60),
    jeju: one("jeju") === "1" ? true : undefined,
    all: one("all") === "1" ? true : undefined,
  };
}

export function matches(it: BankItem, f: BankFilter): boolean {
  if (!f.all && !it.confirmed) return false;
  if (f.level && it.schoolLevel !== f.level) return false;
  if (f.grade && String(it.grade ?? "") !== f.grade) return false;
  if (f.year && it.year !== f.year) return false;
  if (f.area && squash(it.area) !== squash(f.area)) return false;
  if (f.unit && !squash(it.unit).includes(squash(f.unit))) return false;
  if (f.diff && !f.diff.includes(it.difficulty)) return false;
  if (f.type && it.type !== f.type) return false;
  if (f.school && !squash(it.examName).includes(squash(f.school))) return false;
  if (f.jeju && !it.isJeju) return false;
  if (f.q) {
    const q = squash(f.q);
    const hay = squash(it.statement) + "|" + squash(it.unit) + "|" + squash(it.area) + "|" + squash(it.examName);
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** 거른 결과: 최근 시험 먼저, 같은 시험은 문항 순서대로 */
export function search(items: BankItem[], f: BankFilter): BankItem[] {
  return items
    .filter((it) => matches(it, f))
    .sort(
      (a, b) =>
        String(b.year ?? "").localeCompare(String(a.year ?? "")) ||
        a.examName.localeCompare(b.examName, "ko") ||
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label, "ko", { numeric: true })
    );
}

export type Facets = {
  areas: { name: string; n: number }[];
  units: { name: string; n: number }[];
  years: string[];
  diffs: Record<string, number>;
};

/** 고를 수 있는 값(지금 걸린 조건에서 그 칸만 풀어 본 개수) */
export function facets(items: BankItem[], f: BankFilter): Facets {
  const count = (arr: BankItem[], key: (x: BankItem) => string) => {
    const m = new Map<string, { name: string; n: number }>();
    for (const it of arr) {
      const name = key(it).trim();
      if (!name) continue;
      const k = squash(name);
      const e = m.get(k) ?? { name, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ko"));
  };
  const areaBase = items.filter((it) => matches(it, { ...f, area: undefined, unit: undefined }));
  const unitBase = items.filter((it) => matches(it, { ...f, unit: undefined }));
  const diffBase = items.filter((it) => matches(it, { ...f, diff: undefined }));
  const diffs: Record<string, number> = {};
  for (const d of DIFFS) diffs[d] = diffBase.filter((it) => it.difficulty === d).length;
  const years = Array.from(new Set(items.map((it) => it.year).filter((y): y is string => !!y))).sort().reverse();
  return { areas: count(areaBase, (x) => x.area), units: count(unitBase, (x) => x.unit).slice(0, 60), years, diffs };
}
