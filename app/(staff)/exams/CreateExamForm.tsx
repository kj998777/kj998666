"use client";

import { useState, useTransition } from "react";
import { createExam } from "./actions";

export default function CreateExamForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setMsg("");
        start(async () => {
          const r = await createExam(formData);
          // 성공하면 액션 안에서 redirect() 가 실행되어 여기까지 오지 않는다.
          if (r && r.ok === false) setMsg(r.msg ?? "실패했습니다.");
        });
      }}
    >
      <div>
        <label className="label">시험 코드 (학생이 접속 링크에 쓰는 값)</label>
        <input name="code" className="input" placeholder="dg2025-mid" required />
      </div>
      <div>
        <label className="label">시험 이름</label>
        <input name="name" className="input" placeholder="대기고 1-2 공통수학2 중간고사" required />
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "만드는 중…" : "만들기"}
      </button>
    </form>
  );
}
