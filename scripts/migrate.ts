// 구글 시트 → Supabase(Postgres) 1회성 이전 스크립트.
//
// 사용법(README.md 에 더 자세히 있음):
//   1) 원본 구글 시트에서 아래 파일들을 CSV로 내려받아 scripts/data/ 안에 그대로 이름 맞춰 넣는다
//      (scripts/data/ 는 .gitignore 되어 있어 학생 이름이 들어 있어도 커밋되지 않는다):
//        scripts/data/classes.csv        ← "반목록" 탭 (학교급,학년,반)
//        scripts/data/exams.csv          ← "시험목록" 탭 (시험코드,시험명,상태)
//        scripts/data/answer_key.csv     ← "정답" 탭 전체 (시험코드,문항,정답,배점,유형)
//        scripts/data/submissions_<시험코드>.csv  ← 시험별 "제출_<코드>" 탭, 시험마다 파일 하나
//   2) 이 프로젝트 루트에 .env.local 을 만들고 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 채운다
//   3) supabase/migrations/0001_init.sql 을 먼저 Supabase에 실행해 스키마를 만든 다음
//   4) npm run migrate  (= tsx scripts/migrate.ts)
//
// 채점은 옛 시트에 저장된 값을 그대로 믿지 않고, 이전한 정답으로 lib/grading.ts를 다시 돌려서
// 계산한다 — 새 채점 엔진과 항상 일치하는 결과를 보장하기 위함(구 시트의 "채점_<코드>" 탭은 쓰지 않음).
//
// 사용자 결정: 가상 반·테스트 제출(DG2025 가상A~D, TEST 등)도 전부 그대로 옮긴다.
// 나중에 필요하면 새 사이트의 반 관리/채점 결과 화면에서 직접 지우면 된다.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { gradeSubmission, type AnswerKeyItem } from "../lib/grading";

// ---- .env.local 을 아주 단순하게 직접 읽는다 (dotenv 패키지 설치 없이 동작하도록) ----
function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다.");
  process.exit(1);
}
const supabase = createClient(url, key);

const DATA_DIR = path.join(process.cwd(), "scripts", "data");

// ---- 아주 단순한 CSV 파서 (따옴표로 감싼 칸의 쉼표·줄바꿈도 처리) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  text = text.replace(/^﻿/, ""); // BOM 제거
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function readCsvObjects(file: string): Record<string, string>[] {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`(건너뜀) ${file} 없음`);
    return [];
  }
  const rows = parseCsv(fs.readFileSync(full, "utf8"));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function readCsvRaw(file: string): string[][] {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) return [];
  return parseCsv(fs.readFileSync(full, "utf8"));
}

async function main() {
  console.log("=== 1. 반목록 이전 ===");
  const classRows = readCsvObjects("classes.csv");
  let classAdded = 0;
  for (const r of classRows) {
    const level = String(r["학교급"] ?? "").trim();
    const grade = Number(r["학년"]);
    const name = String(r["반"] ?? "").trim();
    if (!["초", "중", "고"].includes(level) || !grade || !name) continue;
    const { error } = await supabase.from("classes").upsert({ level, grade, name }, { onConflict: "level,grade,name" });
    if (error) console.warn(`  반 추가 실패(${level}${grade} ${name}): ${error.message}`);
    else classAdded++;
  }
  console.log(`  ${classAdded}/${classRows.length}개 반 반영`);

  console.log("=== 2. 시험목록 이전 ===");
  const examRows = readCsvObjects("exams.csv");
  const examIdByCode = new Map<string, string>();
  const wantOpenByCode = new Map<string, boolean>();
  for (const r of examRows) {
    const code = String(r["시험코드"] ?? "").trim();
    const name = String(r["시험명"] ?? code).trim();
    const status = String(r["상태"] ?? "닫힘").trim() === "열림" ? "열림" : "닫힘";
    if (!code) continue;
    // 정답이 없는 상태에서 "열림"으로 insert하면 DB 트리거가 막으므로, 일단 닫힘으로 넣고 마지막에 정리한다.
    const { data, error } = await supabase
      .from("exams")
      .upsert({ code, name, status: "닫힘" }, { onConflict: "code" })
      .select("id")
      .single();
    if (error) {
      console.warn(`  시험 추가 실패(${code}): ${error.message}`);
      continue;
    }
    examIdByCode.set(code, data.id);
    wantOpenByCode.set(code, status === "열림");
  }
  console.log(`  ${examIdByCode.size}개 시험 반영`);

  console.log("=== 3. 정답 이전 ===");
  const keyRows = readCsvObjects("answer_key.csv");
  const keyByExam = new Map<string, AnswerKeyItem[]>(); // 재채점용 캐시
  let keyAdded = 0;
  for (const r of keyRows) {
    const code = String(r["시험코드"] ?? "").trim();
    const examId = examIdByCode.get(code);
    if (!examId) continue;
    const item_label = String(r["문항"] ?? "").trim();
    const correct_answers = String(r["정답"] ?? "").trim();
    const points = Number(r["배점"]) || 0;
    const rawType = String(r["유형"] ?? "").trim();
    const type: "객관식" | "주관식" = /^(객관|mc|choice)/i.test(rawType)
      ? "객관식"
      : /^(주관|서답|서술|단답|sa|short)/i.test(rawType)
        ? "주관식"
        : /^[1-5](\|[1-5])*$/.test(correct_answers) && /^\d+$/.test(item_label)
          ? "객관식"
          : "주관식";
    if (!item_label || !correct_answers) continue;

    const { error } = await supabase
      .from("answer_key")
      .upsert(
        { exam_id: examId, item_label, correct_answers, points, type, sort_order: keyAdded },
        { onConflict: "exam_id,item_label" }
      );
    if (error) {
      console.warn(`  정답 추가 실패(${code} ${item_label}번): ${error.message}`);
      continue;
    }
    keyAdded++;
    if (!keyByExam.has(code)) keyByExam.set(code, []);
    keyByExam.get(code)!.push({ item_label, correct_answers, points, type });
  }
  console.log(`  ${keyAdded}개 문항 반영`);

  console.log("=== 4. 시험 상태(열림/닫힘) 복원 ===");
  for (const [code, examId] of examIdByCode) {
    if (!wantOpenByCode.get(code)) continue;
    if (!keyByExam.get(code)?.length) {
      console.warn(`  ${code}: 정답이 없어 "열림"으로 되돌리지 못함 (닫힘 상태로 둠)`);
      continue;
    }
    const { error } = await supabase.from("exams").update({ status: "열림" }).eq("id", examId);
    if (error) console.warn(`  ${code} 열기 실패: ${error.message}`);
  }

  console.log("=== 5. 제출 + 채점 결과 이전 (scripts/data/submissions_<코드>.csv) ===");
  let subTotal = 0;
  let subOk = 0;
  for (const code of examIdByCode.keys()) {
    const file = `submissions_${code}.csv`;
    const rows = readCsvRaw(file);
    if (rows.length === 0) continue;
    const [header, ...dataRows] = rows;
    // header: 제출시각, 반, 이름, <문항라벨...>
    const itemLabels = header.slice(3);
    const key = keyByExam.get(code) ?? [];
    const keyByLabel = new Map(key.map((k) => [k.item_label, k]));
    const orderedKey = itemLabels.map((label) => keyByLabel.get(label)).filter(Boolean) as AnswerKeyItem[];
    if (orderedKey.length !== itemLabels.length) {
      console.warn(`  ${file}: 정답에 없는 문항 라벨이 있어 건너뜁니다 (헤더: ${itemLabels.join(",")})`);
      continue;
    }
    const examId = examIdByCode.get(code)!;

    for (const r of dataRows) {
      subTotal++;
      const submittedAt = r[0] || new Date().toISOString();
      const class_label = String(r[1] ?? "").trim();
      const student_name = String(r[2] ?? "").trim().slice(0, 20);
      const rawAnswers = itemLabels.map((_, i) => r[3 + i] ?? "");
      if (!class_label || !student_name) continue;

      const { perItem, totalScore } = gradeSubmission(orderedKey, rawAnswers);

      const { data: sub, error: subErr } = await supabase
        .from("submissions")
        .insert({
          exam_id: examId,
          class_label,
          student_name,
          answers: perItem.map((p) => p.given),
        })
        .select("id")
        .single();

      if (subErr) {
        if (!subErr.message.includes("duplicate")) {
          console.warn(`  ${code} / ${class_label} ${student_name}: ${subErr.message}`);
        }
        continue;
      }

      const { error: gErr } = await supabase
        .from("grading_results")
        .insert({ submission_id: sub.id, exam_id: examId, per_item: perItem, total_score: totalScore });
      if (gErr) console.warn(`  ${code} / ${class_label} ${student_name}: 채점결과 저장 실패 - ${gErr.message}`);
      else subOk++;
    }
  }
  console.log(`  ${subOk}/${subTotal}건 제출 + 채점결과 반영`);

  console.log("\n마이그레이션 끝. Supabase 대시보드에서 표(Table Editor)로 확인해 보세요.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
