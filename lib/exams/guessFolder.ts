// 시험 이름(=보통 PDF 파일 이름)과 코드에서 폴더 분류(학교급·연도·학년·학기·중간/기말)를 읽어 낸다.
//
// 2026-10-03 원장님 요청: "미분류 파일들 폴더에 넣어 주고, 파일 업로드하면 제목 자동으로 읽어서 자동분류".
// 시험지 파일 이름은 대부분 "서울_강남구_휘문고등학교 1학년 2025년 2학기 공통수학2 중간_" 이나
// "제주 제주시 남녕고등학교 2학년 2023년 2학기 수학 II 중간", "남녕고 1학년 2025-2학기 공통수학2 중간" 처럼
// 필요한 정보가 다 들어 있다. 코드도 "2025-22M04"(연도-학년학기 M=중간/F=기말 번호) 꼴이면 같이 쓴다.
//
// 못 읽은 칸은 null로 둔다(억지로 채우지 않음). 사람이 고른 값이 있으면 그쪽이 우선이고(mergeFolder),
// 이 함수는 빈 칸만 채우는 데 쓴다. "server-only"가 아니라서 업로드 화면(브라우저)에서도 미리보기로 쓴다.
// 순수 함수라 test/guessFolder.test.ts에서 검사한다.

export type GuessedFolder = {
  school_level: "초" | "중" | "고" | null;
  folder_year: string | null;
  folder_grade: number | null;
  folder_term: number | null;
  folder_kind: "중간" | "기말" | "기타" | null;
};

const EMPTY: GuessedFolder = { school_level: null, folder_year: null, folder_grade: null, folder_term: null, folder_kind: null };

function clean(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/\.pdf$/i, "")
    .replace(/[_·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 코드 "2025-22M04" / "2024-12F01" → 연도·학년·학기·구분 */
function fromCode(code: string): Partial<GuessedFolder> {
  const m = clean(code).match(/^(20\d{2})-([1-3])([12])([MF])\d+$/i);
  if (!m) return {};
  return {
    folder_year: m[1],
    folder_grade: Number(m[2]),
    folder_term: Number(m[3]),
    folder_kind: m[4].toUpperCase() === "M" ? "중간" : "기말",
  };
}

function fromName(raw: string): Partial<GuessedFolder> {
  const s = clean(raw);
  if (!s) return {};
  const out: Partial<GuessedFolder> = {};

  // 학교급: "고등학교/여고/○○고", "중학교/여중/○○중", "초등학교". "중간"·"고사"의 중/고는 학교가 아니다.
  if (/초등학교/.test(s)) out.school_level = "초";
  else if (/고등학교|고교|[가-힣]고(?![가-힣])|(?:^|[^가-힣])고\s*[1-3](?![0-9])/.test(s)) out.school_level = "고";
  else if (/중학교|[가-힣]중(?![가-힣])|(?:^|[^가-힣])중\s*[1-3](?![0-9])/.test(s)) out.school_level = "중";
  // 과목으로도 알 수 있으면(공통수학·수학 I/II·미적분 등은 고등학교 과목)
  if (!out.school_level && /공통수학|수학\s*(?:I{1,2}|Ⅰ|Ⅱ|[12])(?![0-9])|미적분|확률과\s*통계|기하|대수/.test(s)) out.school_level = "고";

  // 연도: "2025년", "2025학년도", "2025-2학기", 그 밖에 따로 떨어진 20xx
  const y =
    s.match(/(20\d{2})\s*(?:년|학년도)/) ??
    s.match(/(20\d{2})\s*[-.]\s*[12]\s*학기/) ??
    s.match(/(?:^|[^0-9])(20[0-4]\d)(?![0-9])/);
  if (y) out.folder_year = y[1];

  // 학년: "1학년", "고1", "중2"
  const g = s.match(/([1-3])\s*학년(?!도)/) ?? s.match(/(?:^|[^가-힣])(?:고|중)\s*([1-3])(?![0-9])/);
  if (g) out.folder_grade = Number(g[1]);

  // 학기: "2학기", "(2)학기", "2025-2학기"
  const t = s.match(/\(?\s*([12])\s*\)?\s*학기/);
  if (t) out.folder_term = Number(t[1]);

  // 구분: 중간/기말(1차·2차 지필/고사도), 모의고사·학력평가는 기타
  if (/중간|1\s*차\s*(?:지필|고사|평가)/.test(s)) out.folder_kind = "중간";
  else if (/기말|2\s*차\s*(?:지필|고사|평가)/.test(s)) out.folder_kind = "기말";
  else if (/모의고사|학력평가|모평|수능/.test(s)) out.folder_kind = "기타";

  // 과목으로 학년 보충: 공통수학1·2는 고1 과목
  if (out.folder_grade == null && /공통수학/.test(s) && out.school_level !== "중") out.folder_grade = 1;

  return out;
}

/** 이름(파일 이름)과 코드를 읽어 폴더 분류를 추측한다. 이름에서 읽은 값이 코드보다 우선. */
export function guessFolder(name: string, code = ""): GuessedFolder {
  const c = fromCode(code);
  const n = fromName(name);
  const nc = fromName(code); // 코드가 파일 이름 그대로인 경우도 많다
  const pick = <K extends keyof GuessedFolder>(k: K): GuessedFolder[K] =>
    ((n[k] ?? c[k] ?? nc[k] ?? null) as GuessedFolder[K]);
  return {
    school_level: pick("school_level"),
    folder_year: pick("folder_year"),
    folder_grade: pick("folder_grade"),
    folder_term: pick("folder_term"),
    folder_kind: pick("folder_kind"),
  };
}

/** 사람이 고른 값(빈 칸은 null)을 우선하고, 빈 칸만 추측값으로 채운다. */
export function mergeFolder(chosen: GuessedFolder, guessed: GuessedFolder): GuessedFolder {
  return {
    school_level: chosen.school_level ?? guessed.school_level,
    folder_year: chosen.folder_year ?? guessed.folder_year,
    folder_grade: chosen.folder_grade ?? guessed.folder_grade,
    folder_term: chosen.folder_term ?? guessed.folder_term,
    folder_kind: chosen.folder_kind ?? guessed.folder_kind,
  };
}

/** 화면 표시용: "고 · 2025 · 1학년 · 2학기 · 중간" (못 읽은 칸은 빼고), 하나도 없으면 "" */
export function folderLabel(f: GuessedFolder): string {
  const parts: string[] = [];
  if (f.school_level) parts.push(f.school_level);
  if (f.folder_year) parts.push(f.folder_year);
  if (f.folder_grade) parts.push(`${f.folder_grade}학년`);
  if (f.folder_term) parts.push(`${f.folder_term}학기`);
  if (f.folder_kind) parts.push(f.folder_kind);
  return parts.join(" · ");
}

export const EMPTY_FOLDER = EMPTY;
