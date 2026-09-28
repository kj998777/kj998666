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
        // 서버(ai-actions.ts의 readPdf)도 같은 검사를 하지만, 그건 요청이 서버까지 도착한 "뒤"에야
        // 실행된다. Vercel 서버리스 함수 자체의 요청 본문 크기 제한(약 4.5MB)을 넘으면 서버 코드가
        // 실행되기도 전에 플랫폼이 413으로 요청을 거부해 버려서, 서버의 친절한 한국어 안내 메시지가
        // 아예 뜨지 못하고 화면에 "Application error" 같은 클라이언트 오류만 보이는 문제가 있었다
        // (2026-09-28 원장님 신고로 발견). 그래서 여기서 먼저 걸러 아예 요청을 보내지 않는다.
        const file = formData.get("pdf");
        if (file instanceof File && file.size > 4 * 1024 * 1024) {
          setMsg("PDF 용량이 너무 큽니다(4MB 이하로 줄여서 올려 주세요 — 서버 업로드 용량 제한).");
          return;
        }
        start(async () => {
          const r = await createAiExam(formData);
          // 성공하면 액션 안에서 redirect() 가 실행되어 여기까지 오지 않는다.
          if (!r) {
            setMsg("요청이 실패했습니다(파일이 너무 크거나 네트워크 문제일 수 있습니다). 다시 시도해 주세요.");
          } else if (r.ok === false) {
            setMsg(r.msg ?? "실패했습니다.");
          }
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
      <div>
        <label className="label">학교급</label>
        <select name="school_level" className="input" defaultValue="">
          <option value="">선택 안 함</option>
          <option value="초">초등학교</option>
          <option value="중">중학교</option>
          <option value="고">고등학교</option>
        </select>
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
