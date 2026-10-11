// 고3 사설 모의고사(lib/exams/mockCsat.ts) — node --experimental-strip-types test/mockCsat.test.ts
import assert from "node:assert/strict";
import {
  answersFromKeys,
  buildKeyRows,
  choiceFromLabels,
  choiceOfLabel,
  csatSpec,
  displayNo,
  emptyAnswers,
  examMaxPoints,
  keysForChoice,
  keysForStudent,
  mockItemMeta,
  reportForStudent,
  reportGroups,
  COMMON_NOS,
  CHOICE_NOS,
} from "../lib/exams/mockCsat";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  통과", name);
}

check("수능 배점 합 = 공통 74 + 선택 26", () => {
  const c = COMMON_NOS.reduce((a, no) => a + csatSpec(no, "공통").points, 0);
  const s = CHOICE_NOS.reduce((a, no) => a + csatSpec(no, "미적").points, 0);
  assert.equal(c, 74);
  assert.equal(s, 26);
  assert.equal(csatSpec(15, "공통").type, "객관식");
  assert.equal(csatSpec(16, "공통").type, "주관식");
  assert.equal(csatSpec(28, "기하").type, "객관식");
  assert.equal(csatSpec(29, "기하").type, "주관식");
});

check("번호·과목 읽기", () => {
  assert.equal(choiceOfLabel("미적23"), "미적");
  assert.equal(choiceOfLabel("23"), null);
  assert.equal(choiceOfLabel("서술형1"), null);
  assert.equal(displayNo("확통30"), "30");
  assert.equal(displayNo("7"), "7");
});

function full(): ReturnType<typeof emptyAnswers> {
  const a = emptyAnswers();
  for (const no of COMMON_NOS) a.공통[no] = no <= 15 ? String(((no - 1) % 5) + 1) : String(no * 3);
  for (const no of CHOICE_NOS) a.미적[no] = no <= 28 ? "③" : "12";
  return a;
}

check("정답표 줄 만들기 — 공통 + 다 찬 과목만", () => {
  const a = full();
  a.확통[23] = "2"; // 한 문항만 찬 과목 → 넣지 않고 빠진 번호로 알림
  const { rows, missing, subjects } = buildKeyRows(a);
  assert.deepEqual(subjects, ["미적"]);
  assert.equal(rows.length, 30);
  assert.equal(rows[22].item_label, "미적23");
  assert.equal(rows[22].correct_answers, "3"); // ③ → 3
  assert.equal(rows[29].type, "주관식");
  assert.equal(missing.length, 7);
  assert.ok(missing[0].startsWith("확률과 통계"));
});

check("공통이 비면 빠진 번호", () => {
  const a = full();
  delete a.공통[5];
  a.공통[6] = "7"; // 객관식에 7 → 잘못된 값
  const { missing } = buildKeyRows(a);
  assert.deepEqual(missing, ["공통 5번", "공통 6번"]);
});

check("정답표 → 입력 모양 되돌리기", () => {
  const { rows } = buildKeyRows(full());
  const back = answersFromKeys(rows);
  assert.equal(back.미적[29], "12");
  assert.equal(back.공통[16], "48");
});

check("과목별 문항·학생별 문항·만점", () => {
  const a = full();
  for (const no of CHOICE_NOS) a.기하[no] = no <= 28 ? "1" : "5";
  const { rows } = buildKeyRows(a);
  assert.equal(keysForChoice(rows, "기하").length, 30);
  assert.ok(keysForChoice(rows, "기하").every((k) => !k.item_label.startsWith("미적")));
  const per = keysForChoice(rows, "미적").map((k) => k.item_label);
  assert.equal(choiceFromLabels(per), "미적");
  assert.equal(keysForStudent(rows, per).length, 30);
  assert.equal(examMaxPoints(rows), 100); // 과목이 둘이어도 만점은 100
  const plain = [{ item_label: "1", points: 50 }, { item_label: "2", points: 50 }];
  assert.equal(examMaxPoints(plain), 100);
  assert.equal(keysForStudent(plain, ["1"]).length, 2); // 선택과목 없는 시험은 그대로
});

check("보고서용 영역·난이도", () => {
  assert.deepEqual(mockItemMeta("미적30", 4), { area: "미적분", difficulty: "상" });
  assert.deepEqual(mockItemMeta("1", 2), { area: "공통(수학Ⅰ·수학Ⅱ)", difficulty: "하" });
});

check("보고서: 학생 몫·과목별 묶음", () => {
  const items = [{ label: "1" }, { label: "미적23" }, { label: "기하23" }];
  const d = {
    items,
    students: [
      { id: "a", per_item: [{ item_label: "1" }, { item_label: "미적23" }] },
      { id: "b", per_item: [{ item_label: "1" }, { item_label: "기하23" }] },
      { id: "c", per_item: [{ item_label: "1" }, { item_label: "미적23" }] },
    ],
  };
  assert.deepEqual(reportForStudent(d, ["1", "기하23"]).items.map((i) => i.label), ["1", "기하23"]);
  const g = reportGroups(d);
  assert.deepEqual(g.map((x) => [x.name, x.data.students.length, x.data.items.length]), [["미적분", 2, 2], ["기하", 1, 2]]);
  const plain = { items: [{ label: "1" }], students: [{ per_item: [{ item_label: "1" }] }] };
  assert.equal(reportGroups(plain).length, 1);
  assert.equal(reportForStudent(plain, ["1"]), plain);
});

console.log(`mockCsat: ${n}개 통과`);
