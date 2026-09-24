"use client";

import { useState, useTransition } from "react";
import { createAiExam } from "./ai-actions";

export default function CreateAiExamForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setMsg("");
        start(async () => {
          const r = await createAiExam(formData);
          // 성공하면 액션 안에서 redirect() 가 실행되어 여기까지 오지 않는다.
          if (r && r.ok === false) setMsg(r.msg ?? "실패했습니다.");
        });
      }}
    >
      <div>
        <label className="label">시험 코드</label>
        <input name="code" className="input" placeholder="dg2025-mid" required />
      </div>
      <div>
        <label className="label">시험 이름</label>
        <input name="name" className="input" placeholder="대기고 1-2 공통수학2 중간고사" required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">연도</label>
          <input name="folder_year" className="input" placeholder="2026" />
        </div>
        <div>
          <label className="label">학년</label>
          <select name="folder_grade" className="input">
            <option value="">선택 안 함</option>
            <option value="1">1학년</option>
            <option value="2">2학년</option>
            <option value="3">3학년</option>
          </select>
        </div>
        <div>
          <label className="label">학기</label>
          <select name="folder_term" className="input">
            <option value="">선택 안 함</option>
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </select>
        </div>
        <div>
          <label className="label">구분</label>
          <select name="folder_kind" className="input">
            <option value="">선택 안 함</option>
            <option value="중간">중간고사</option>
            <option value="기말">기말고사</option>
            <option value="기타">기타</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">시험지 PDF</label>
        <input type="file" name="pdf" accept="application/pdf" required className="text-sm" />
        <p className="text-xs text-slate-500 mt-1">
          AI가 문항을 읽어 정답·해설을 자동으로 만듭니다. 다 되면 검수 화면에서 확인 후 시험을 열면 됩니다.
        </p>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "만드는 중… (PDF 올리고 AI 처리를 시작합니다)" : "만들고 AI 자동 처리 시작"}
      </button>
    </form>
  );
}
