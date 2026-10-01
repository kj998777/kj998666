import assert from "node:assert/strict";
import { isNewCurriculumExam, reviewJejuLevel } from "../lib/tutor/priority";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; };
ok(isNewCurriculumExam("서울_강남구_휘문고등학교 1학년 2025년 2학기 공통수학2 중간_"), "공통수학2");
ok(isNewCurriculumExam("공통 수학 Ⅱ 기말"), "띄어쓰기·로마 숫자");
ok(isNewCurriculumExam("OO고 1학년 2025년 1학기 공통수학1 중간"), "공통수학1");
ok(!isNewCurriculumExam("제주_제주시_남녕고등학교 2학년 2023년 2학기 수학 II 중간_"), "수학 II는 아님");
ok(!isNewCurriculumExam("OO고 1학년 2024년 2학기 수학(하) 중간"), "옛 과정 수학(하)는 아님");
ok(reviewJejuLevel({ is_jeju: true, name: "제주 수학 II" }), "제주 학교");
ok(reviewJejuLevel({ is_jeju: false, name: "서울 공통수학2" }), "타 지역 공통수학2");
ok(!reviewJejuLevel({ is_jeju: false, name: "서울 수학 II" }), "타 지역 다른 과목");
console.log(`${n}개 통과`);
