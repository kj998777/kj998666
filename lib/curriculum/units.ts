// 2026-10-01 원장님 요청: 입학테스트·문항 은행(학원·과외선생님)에서 "학교급 → 학년 → 과목 → 출제할 단원(대단원 안에 중단원)"을
// 체크해서 범위를 고르게. 문항의 단원(item_explanations.area·unit)은 AI가 자유롭게 적은 글이라("평면좌표와 직선", "직선·점의 좌표" …)
// 교과서 단원표를 여기 한 곳에 두고, 문항마다 area·unit 글을 단원표의 중단원에 자동으로 붙인다(classify).
// 순수 계산만 둔다(화면·서버·test/curriculum.test.ts가 같이 씀). 단원표를 고치면 중단원 id(과목.대단원번호.중단원번호)가 바뀌니
// 저장된 링크(?u=…)만 영향을 받고 DB에는 저장하지 않는다.

export type Level = "중" | "고";

type MidDef = { name: string; kw: string[] };
type BigDef = { name: string; mids: MidDef[] };
type CourseDef = { key: string; name: string; level: Level; grades: number[]; bigs: BigDef[] };

const C = (key: string, name: string, level: Level, grades: number[], bigs: [string, [string, string[]][]][]): CourseDef => ({
  key,
  name,
  level,
  grades,
  bigs: bigs.map(([bn, mids]) => ({ name: bn, mids: mids.map(([mn, kw]) => ({ name: mn, kw })) })),
});

// 중학교는 2015 개정 교과서 차례(지금 기출이 이 교육과정), 고1은 2022 개정 공통수학1·2(2015 수학(상)·(하) 기출도 여기에 붙인다),
// 고2·3은 2015 개정 과목(2022 개정 대수 = 수학Ⅰ, 미적분Ⅰ = 수학Ⅱ). 키워드는 띄어쓰기 없이 비교하고, 가장 길게 맞는 키워드가 이긴다.
export const COURSES: CourseDef[] = [
  C("m1", "중1 수학", "중", [1], [
    ["수와 연산", [
      ["소인수분해", ["소인수분해", "소인수", "소수와합성수", "최대공약수", "최소공배수", "거듭제곱"]],
      ["정수와 유리수", ["정수와유리수", "정수", "유리수", "절댓값", "수직선"]],
    ]],
    ["문자와 식", [
      ["문자의 사용과 식의 계산", ["문자의사용", "식의값", "일차식", "동류항", "문자와식"]],
      ["일차방정식", ["일차방정식", "방정식", "등식"]],
    ]],
    ["좌표평면과 그래프", [
      ["좌표와 그래프", ["좌표평면", "좌표", "순서쌍", "사분면", "그래프"]],
      ["정비례와 반비례", ["정비례", "반비례"]],
    ]],
    ["기본 도형", [
      ["기본 도형", ["기본도형", "직선", "반직선", "선분", "맞꼭지각", "평행선", "동위각", "엇각", "꼬인위치", "수선"]],
      ["작도와 합동", ["작도", "합동"]],
    ]],
    ["평면도형과 입체도형", [
      ["평면도형의 성질", ["평면도형", "다각형", "내각", "외각", "부채꼴", "중심각"]],
      ["입체도형의 성질", ["입체도형", "다면체", "회전체", "겉넓이", "부피"]],
    ]],
    ["통계", [
      ["자료의 정리와 해석", ["자료의정리", "줄기와잎", "도수분포", "히스토그램", "상대도수", "대푯값", "평균", "중앙값", "최빈값"]],
    ]],
  ]),
  C("m2", "중2 수학", "중", [2], [
    ["수와 식의 계산", [
      ["유리수와 순환소수", ["순환소수", "유한소수", "유리수와순환소수"]],
      ["식의 계산", ["식의계산", "지수법칙", "단항식", "다항식의계산", "다항식"]],
    ]],
    ["부등식과 연립방정식", [
      ["일차부등식", ["일차부등식", "부등식"]],
      ["연립일차방정식", ["연립일차방정식", "연립방정식", "연립"]],
    ]],
    ["일차함수", [
      ["일차함수와 그래프", ["일차함수", "기울기", "절편"]],
      ["일차함수와 일차방정식의 관계", ["일차함수와일차방정식", "일차방정식의그래프", "직선의방정식", "연립방정식의해와그래프"]],
    ]],
    ["도형의 성질", [
      ["삼각형의 성질", ["삼각형의성질", "이등변삼각형", "이등변", "외심", "내심", "직각삼각형의합동"]],
      ["사각형의 성질", ["사각형의성질", "평행사변형", "사다리꼴", "마름모", "직사각형", "정사각형", "사각형"]],
    ]],
    ["도형의 닮음과 피타고라스 정리", [
      ["도형의 닮음", ["도형의닮음", "닮음", "닮음비"]],
      ["닮음의 활용", ["닮음의활용", "삼각형의중점", "평행선과선분", "무게중심"]],
      ["피타고라스 정리", ["피타고라스"]],
    ]],
    ["확률", [
      ["경우의 수", ["경우의수"]],
      ["확률", ["확률"]],
    ]],
  ]),
  C("m3", "중3 수학", "중", [3], [
    ["실수와 그 계산", [
      ["제곱근과 실수", ["제곱근과실수", "제곱근", "무리수", "실수"]],
      ["근호를 포함한 식의 계산", ["근호를포함한식", "근호", "분모의유리화", "유리화"]],
    ]],
    ["다항식의 곱셈과 인수분해", [
      ["다항식의 곱셈", ["다항식의곱셈", "곱셈공식"]],
      ["인수분해", ["인수분해"]],
    ]],
    ["이차방정식", [
      ["이차방정식", ["이차방정식", "근의공식", "판별식"]],
    ]],
    ["이차함수", [
      ["이차함수와 그 그래프", ["이차함수와그래프", "이차함수", "y=ax²", "y=a(x-p)²+q", "평행이동", "꼭짓점", "그래프"]],
      ["이차함수 y=ax²+bx+c의 그래프", ["y=ax²+bx+c", "일반형", "이차함수의식과활용", "이차함수의활용", "식과활용", "함숫값", "함수값", "최댓값", "최솟값"]],
    ]],
    ["삼각비", [
      ["삼각비", ["삼각비의뜻", "삼각비의값", "삼각비의표", "특수각", "삼각비"]],
      ["삼각비의 활용", ["삼각비의활용", "넓이", "길이", "높이"]],
    ]],
    ["원의 성질", [
      ["원과 직선", ["원과직선", "원과현", "원의접선", "원의중심과현", "현", "접선"]],
      ["원주각", ["원주각", "접선과현이이루는각", "네점이한원"]],
    ]],
    ["통계", [
      ["대푯값과 산포도", ["대푯값과산포도", "대푯값", "산포도", "분산", "표준편차", "편차", "평균", "중앙값", "최빈값"]],
      ["상관관계", ["상관관계", "상관", "산점도"]],
    ]],
  ]),
  C("c1", "공통수학1", "고", [1], [
    ["다항식", [
      ["다항식의 연산", ["다항식의연산", "다항식의덧셈", "다항식의곱셈", "다항식의나눗셈", "곱셈공식", "조립제법", "다항식"]],
      ["항등식과 나머지정리", ["항등식과나머지정리", "나머지정리", "인수정리", "항등식", "미정계수"]],
      ["인수분해", ["인수분해"]],
    ]],
    ["방정식과 부등식", [
      ["복소수와 이차방정식", ["복소수와이차방정식", "복소수", "이차방정식", "판별식", "근과계수"]],
      ["이차방정식과 이차함수", ["이차방정식과이차함수", "이차함수", "최댓값", "최솟값", "그래프와직선"]],
      ["여러 가지 방정식과 부등식", ["여러가지방정식", "삼차방정식", "사차방정식", "고차방정식", "연립이차방정식", "연립방정식", "이차부등식", "연립부등식", "부등식"]],
    ]],
    ["경우의 수", [
      ["경우의 수", ["경우의수", "합의법칙", "곱의법칙"]],
      ["순열과 조합", ["순열과조합", "순열", "조합"]],
    ]],
    ["행렬", [
      ["행렬과 그 연산", ["행렬"]],
    ]],
  ]),
  C("c2", "공통수학2", "고", [1], [
    ["도형의 방정식", [
      ["평면좌표", ["평면좌표", "두점사이의거리", "내분점", "외분점", "점의좌표", "좌표"]],
      ["직선의 방정식", ["직선의방정식", "점과직선사이의거리", "두직선의수직", "두직선의평행", "평행한직선", "수직인직선", "두직선", "정점을지나는직선", "직선의교점", "기울기", "직선"]],
      ["원의 방정식", ["원의방정식", "원과직선", "원의접선", "접선"]],
      ["도형의 이동", ["도형의이동", "평행이동", "대칭이동", "대칭"]],
    ]],
    ["집합과 명제", [
      ["집합", ["집합", "부분집합", "합집합", "교집합", "여집합", "차집합"]],
      ["명제", ["명제", "필요조건", "충분조건", "대우", "절대부등식", "조건"]],
    ]],
    ["함수와 그래프", [
      ["함수", ["합성함수", "역함수", "일대일함수", "일대일대응", "함수"]],
      ["유리함수와 무리함수", ["유리함수와무리함수", "유리함수", "무리함수", "유리식", "무리식"]],
    ]],
  ]),
  C("s1", "수학Ⅰ", "고", [2, 3], [
    ["지수함수와 로그함수", [
      ["지수와 로그", ["지수와로그", "거듭제곱근", "상용로그", "지수법칙", "지수", "로그"]],
      ["지수함수와 로그함수", ["지수함수와로그함수", "지수함수", "로그함수", "지수방정식", "로그방정식", "지수부등식", "로그부등식"]],
    ]],
    ["삼각함수", [
      ["삼각함수", ["삼각함수", "일반각", "호도법", "삼각방정식", "삼각부등식"]],
      ["사인법칙과 코사인법칙", ["사인법칙", "코사인법칙", "삼각형의넓이"]],
    ]],
    ["수열", [
      ["등차수열과 등비수열", ["등차수열과등비수열", "등차수열", "등비수열", "등차중항", "등비중항", "수열"]],
      ["수열의 합", ["수열의합", "시그마", "∑", "Σ", "여러가지수열"]],
      ["수학적 귀납법", ["수학적귀납법", "귀납법", "귀납적정의", "점화식"]],
    ]],
  ]),
  C("s2", "수학Ⅱ", "고", [2, 3], [
    ["함수의 극한과 연속", [
      ["함수의 극한", ["함수의극한", "좌극한", "우극한", "극한"]],
      ["함수의 연속", ["함수의연속", "불연속", "최대최소정리", "사잇값", "연속"]],
    ]],
    ["미분", [
      ["미분계수와 도함수", ["미분계수와도함수", "미분계수", "도함수", "미분가능", "평균변화율", "순간변화율"]],
      ["도함수의 활용", ["도함수의활용", "접선의방정식", "접선", "평균값정리", "롤의정리", "증가", "감소", "극대", "극소", "극값", "최대", "최소", "속도", "가속도"]],
    ]],
    ["적분", [
      ["부정적분", ["부정적분", "적분상수"]],
      ["정적분", ["정적분"]],
      ["정적분의 활용", ["정적분의활용", "넓이", "속도와거리", "거리"]],
    ]],
  ]),
  C("pr", "확률과 통계", "고", [2, 3], [
    ["경우의 수", [
      ["순열과 조합", ["중복순열", "중복조합", "원순열", "같은것이있는순열", "순열", "조합"]],
      ["이항정리", ["이항정리", "이항계수", "파스칼"]],
    ]],
    ["확률", [
      ["확률의 뜻과 활용", ["확률의뜻", "확률의덧셈정리", "여사건", "수학적확률", "통계적확률", "확률"]],
      ["조건부확률", ["조건부확률", "독립시행", "독립", "종속", "확률의곱셈정리"]],
    ]],
    ["통계", [
      ["확률분포", ["확률분포", "확률변수", "이항분포", "정규분포", "기댓값"]],
      ["통계적 추정", ["통계적추정", "추정", "표본", "신뢰구간", "모평균", "표본평균"]],
    ]],
  ]),
  C("ca", "미적분", "고", [2, 3], [
    ["수열의 극한", [
      ["수열의 극한", ["수열의극한", "등비수열의극한"]],
      ["급수", ["급수", "등비급수"]],
    ]],
    ["미분법", [
      ["여러 가지 함수의 미분", ["여러가지함수의미분", "지수함수의미분", "로그함수의미분", "삼각함수의미분", "삼각함수의덧셈정리", "자연로그"]],
      ["여러 가지 미분법", ["여러가지미분법", "몫의미분", "합성함수의미분", "매개변수", "음함수", "역함수의미분", "이계도함수"]],
      ["도함수의 활용", ["도함수의활용", "변곡점", "오목", "볼록", "접선", "극대", "극소", "최대", "최소", "속도"]],
    ]],
    ["적분법", [
      ["여러 가지 적분법", ["여러가지적분법", "치환적분", "부분적분"]],
      ["정적분의 활용", ["정적분의활용", "정적분과급수", "구분구적", "부피", "넓이", "속도와거리"]],
    ]],
  ]),
  C("ge", "기하", "고", [2, 3], [
    ["이차곡선", [
      ["이차곡선", ["이차곡선", "포물선", "타원", "쌍곡선"]],
      ["이차곡선과 직선", ["이차곡선과직선", "이차곡선의접선", "접선"]],
    ]],
    ["평면벡터", [
      ["벡터의 연산", ["벡터의연산", "벡터의덧셈", "실수배", "벡터"]],
      ["평면벡터의 성분과 내적", ["성분", "내적", "벡터방정식"]],
    ]],
    ["공간도형과 공간좌표", [
      ["공간도형", ["공간도형", "정사영", "삼수선", "이면각"]],
      ["공간좌표", ["공간좌표", "좌표공간", "구의방정식"]],
    ]],
  ]),
];

const COURSE_BY_KEY = new Map(COURSES.map((c) => [c.key, c]));

export const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"];

/** 중단원 id: 과목키.대단원번호.중단원번호 (예: c2.1.3 = 공통수학2 Ⅰ.도형의 방정식 3.원의 방정식) */
export const midId = (course: string, b: number, m: number) => `${course}.${b + 1}.${m + 1}`;
/** 그 학년에서 단원표에 못 붙인 문항(기타) id: 예 H1.x */
export const etcId = (level: Level, grade: number) => `${level === "중" ? "M" : "H"}${grade}.x`;
export const UNIT_ID_RE = /^(?:[a-z][a-z0-9]\.\d{1,2}\.\d{1,2}|[MH][1-3]\.x)$/;

export function courseName(key: string): string {
  return COURSE_BY_KEY.get(key)?.name ?? "";
}
export function isCourseKey(key: string): boolean {
  return COURSE_BY_KEY.has(key);
}
/** 그 학년에 고를 수 있는 과목들(단원표 순서) */
export function coursesFor(level: Level, grade: number): CourseDef[] {
  return COURSES.filter((c) => c.level === level && c.grades.includes(grade));
}
/** id → "과목 · 중단원" 이름(보고서·제목용) */
export function unitName(id: string): string {
  if (/^[MH][1-3]\.x$/.test(id)) return "기타(단원 분류 안 됨)";
  const [k, b, m] = id.split(".");
  const c = COURSE_BY_KEY.get(k);
  const mid = c?.bigs[Number(b) - 1]?.mids[Number(m) - 1];
  return mid ? mid.name : "";
}

// ---------------------------------------------------------------------
// 문항 → 중단원
// ---------------------------------------------------------------------

/** 비교용: 띄어쓰기·$·\ 없애고, ^2·^{2} → ², 여러 가지 빼기 기호 → - */
export function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/\^\s*\{?\s*2\s*\}?/g, "²")
    .replace(/[−–—]/g, "-")
    .replace(/[\s$\\{}]/g, "")
    .toLowerCase();
}

const KW: Map<string, { course: string; id: string; kw: string[] }[]> = new Map();
function midsOf(course: CourseDef) {
  let arr = KW.get(course.key);
  if (!arr) {
    arr = [];
    course.bigs.forEach((b, bi) =>
      b.mids.forEach((m, mi) => arr!.push({ course: course.key, id: midId(course.key, bi, mi), kw: Array.from(new Set([norm(m.name), ...m.kw.map(norm)])) }))
    );
    KW.set(course.key, arr);
  }
  return arr;
}

const longest = (text: string, kws: string[]) => {
  let best = 0;
  for (const k of kws) if (k.length > best && text.includes(k)) best = k.length;
  return best;
};

// 시험 이름의 과목 → 먼저 찾아볼 단원표 과목(2015 수학(상)·(하)는 공통수학1·2에 나뉘어 있음, 2022 대수 = 수학Ⅰ, 미적분Ⅰ = 수학Ⅱ)
const SUBJECT_COURSES: [RegExp, string[]][] = [
  [/공통\s*수학\s*(2|Ⅱ|II)/i, ["c2"]],
  [/공통\s*수학\s*(1|Ⅰ|I)/i, ["c1"]],
  [/수학\s*\(?\s*[상하]\s*\)?/, ["c1", "c2"]],
  [/미적분\s*(1|Ⅰ|I)(?![I])/i, ["s2"]],
  [/미적분/, ["ca", "s2"]],
  [/수학\s*(II|Ⅱ|2)(?![0-9])/i, ["s2"]],
  [/수학\s*(I|Ⅰ|1)(?![0-9I])/i, ["s1"]],
  [/대수/, ["s1"]],
  [/확률\s*과\s*통계|확통/, ["pr"]],
  [/기하/, ["ge"]],
];
function preferredCourses(examName: string): string[] {
  const tail = String(examName ?? "").normalize("NFC").replace(/_/g, " ").replace(/^.*?학기/, "");
  for (const [re, keys] of SUBJECT_COURSES) if (re.test(tail)) return keys;
  return [];
}

export type UnitHit = { course: string; id: string } | null;
export type Classifiable = { schoolLevel: string | null; grade: number | null; examName: string; area: string; unit: string };

const memo = new Map<string, UnitHit>();

/**
 * 문항의 중단원. 점수 = 영역(area)에 맞은 가장 긴 키워드 길이 + 단원(unit)에 맞은 가장 긴 키워드 길이(같으면 영역 쪽),
 * 시험 이름의 과목(예: 공통수학2)과 같은 과목이면 +2(비슷할 때만 과목이 이기게 — 글이 더 강하게 맞으면 글을 따른다).
 * 아무것도 안 맞으면 null(기타).
 */
export function classify(it: Classifiable): UnitHit {
  const level = it.schoolLevel === "중" || it.schoolLevel === "고" ? (it.schoolLevel as Level) : null;
  const grade = Number(it.grade);
  if (!level || !(grade >= 1 && grade <= 3)) return null;
  const key = `${level}|${grade}|${it.examName}|${it.area}|${it.unit}`;
  if (memo.has(key)) return memo.get(key)!;
  const area = norm(it.area);
  const unit = norm(it.unit);
  const cands = coursesFor(level, grade);
  const pref = new Set(preferredCourses(it.examName));
  const pick = (courses: CourseDef[]): UnitHit => {
    let best: UnitHit = null;
    let bestScore = 0;
    for (const c of courses)
      for (const m of midsOf(c)) {
        const a = longest(area, m.kw);
        const base = a + longest(unit, m.kw);
        // 같은 점수면 영역(area)에 더 맞은 쪽, 그다음 시험 이름의 과목 쪽
        const s = base > 0 ? (base + (pref.has(c.key) ? 2 : 0)) * 10 + a : 0;
        if (s > bestScore) {
          bestScore = s;
          best = { course: m.course, id: m.id };
        }
      }
    return best;
  };
  const hit = pick(cands);
  if (memo.size > 20000) memo.clear();
  memo.set(key, hit);
  return hit;
}

/** 문항의 범위 id(중단원 id, 못 붙이면 그 학년 기타 id). 학교급·학년이 없으면 "" */
export function unitIdOf(it: Classifiable): string {
  const h = classify(it);
  if (h) return h.id;
  const level = it.schoolLevel === "중" || it.schoolLevel === "고" ? (it.schoolLevel as Level) : null;
  const grade = Number(it.grade);
  return level && grade >= 1 && grade <= 3 ? etcId(level, grade) : "";
}

// ---------------------------------------------------------------------
// 범위(학교급 → 학년 → 과목 → 단원)
// ---------------------------------------------------------------------

/** units: 고른 중단원 id(null = 그 범위 전부) */
export type UnitScope = { level?: Level | ""; grade?: number | null; course?: string; units?: string[] | null };

export function inUnitScope(it: Classifiable, s: UnitScope): boolean {
  if (s.level && it.schoolLevel !== s.level) return false;
  if (s.grade && Number(it.grade) !== Number(s.grade)) return false;
  if (!s.course && !s.units) return true;
  const h = classify(it);
  if (s.course && h?.course !== s.course) return false;
  if (s.units) {
    const id = h ? h.id : unitIdOf(it);
    if (!s.units.includes(id)) return false;
  }
  return true;
}

export type TreeMid = { id: string; name: string; n: number };
export type TreeBig = { name: string; n: number; mids: TreeMid[] };
export type TreeCourse = { key: string; name: string; n: number; bigs: TreeBig[] };
export type TreeGrade = { level: Level; grade: number; n: number; courses: TreeCourse[]; etc: { id: string; n: number } };

/** 화면에 보낼 범위 나무: 문항이 있는 학년, 그 학년에서 문항이 있는 과목(과목 안의 중단원은 0개여도 다 보임 — 문항이 없는 단원도 알 수 있게) */
export function buildTree(items: Classifiable[]): TreeGrade[] {
  const count = new Map<string, number>();
  const gradeN = new Map<string, number>();
  for (const it of items) {
    const id = unitIdOf(it);
    if (!id) continue;
    count.set(id, (count.get(id) ?? 0) + 1);
    const gk = `${it.schoolLevel}${Number(it.grade)}`;
    gradeN.set(gk, (gradeN.get(gk) ?? 0) + 1);
  }
  const out: TreeGrade[] = [];
  for (const level of ["중", "고"] as Level[])
    for (const grade of [1, 2, 3]) {
      const n = gradeN.get(`${level}${grade}`) ?? 0;
      if (!n) continue;
      const courses: TreeCourse[] = [];
      for (const c of coursesFor(level, grade)) {
        const bigs = c.bigs.map((b, bi) => {
          const mids = b.mids.map((m, mi) => {
            const id = midId(c.key, bi, mi);
            return { id, name: m.name, n: count.get(id) ?? 0 };
          });
          return { name: b.name, n: mids.reduce((a, x) => a + x.n, 0), mids };
        });
        const cn = bigs.reduce((a, x) => a + x.n, 0);
        if (cn) courses.push({ key: c.key, name: c.name, n: cn, bigs });
      }
      const eid = etcId(level, grade);
      out.push({ level, grade, n, courses, etc: { id: eid, n: count.get(eid) ?? 0 } });
    }
  return out;
}

/** 범위 글(입학테스트 이름·안내): "고1 · 공통수학2 · 원의 방정식 외 2개 단원" */
export function scopeText(s: UnitScope): string {
  if (!s.level) return "전체";
  let t = `${s.level}${s.grade ?? ""}`;
  t += s.course ? ` · ${courseName(s.course)}` : s.grade ? " · 전 과목" : "";
  if (s.units) {
    const names = s.units.map(unitName).filter(Boolean);
    if (names.length === 1) t += ` · ${names[0]}`;
    else if (names.length > 1) t += ` · ${names[0]} 외 ${names.length - 1}개 단원`;
  }
  return t;
}

/** 화면·주소에서 받은 단원 id 목록 정리(형식이 맞는 것만, 최대 80개) */
export function cleanUnits(v: unknown): string[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : String(v).split(",");
  const out = Array.from(new Set(arr.map((x) => String(x).trim()).filter((x) => UNIT_ID_RE.test(x)))).slice(0, 80);
  return out;
}
