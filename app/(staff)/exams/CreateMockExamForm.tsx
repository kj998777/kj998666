"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMockExam, finalizeSolutionPdf } from "./mock-actions";
import { finalizeAttachExamPdfOnly } from "./ai-actions";
import { pdfTooLarge, uploadPdfDirect, uploadSolutionPdfDirect } from "@/lib/supabase/uploadPdf";
import { fitPdfForUpload } from "@/lib/pdf/shrinkPdf";
import PdfDropInput from "./PdfDropInput";

// 2026-10-11 원장님: "고3 사설모의고사도 입력·제출할 수 있게 — 디지털화·해설 작성 없이 문제지·해설지를 내가 둘 다 올리게".
// 이름 + 문제지 PDF + 해설지 PDF를 받아 시험(0053 mock_csat)을 만들고 두 파일을 올린 뒤 시험 화면으로 간다. 시험 화면에서
// AI가 해설지의 정답을 읽어 표에 채우면(MockCsatPanel) 원장님이 확인해 저장한다. AI 문제 풀이·디지털화는 하지 않는다.
export default function CreateMockExamForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setMsg("");
        const prob = fd.get("problem");
        const sol = fd.get("solution");
        if (!(prob instanceof File) || prob.size === 0) return setMsg("문제지 PDF를 골라 주세요.");
        if (!(sol instanceof File) || sol.size === 0) return setMsg("해설지 PDF를 골라 주세요.");
        start(async () => {
          setStep("시험 만드는 중…");
          // 서버 액션에는 이름·코드만 보낸다 — PDF까지 실으면 Vercel 요청 한도(4.5MB)를 넘어 실패한다(2026-10-11 실제 오류).
          // PDF는 아래에서 브라우저가 Storage에 직접 올린다.
          const meta = new FormData();
          meta.set("name", String(fd.get("name") ?? ""));
          meta.set("code", String(fd.get("code") ?? ""));
          let c: Awaited<ReturnType<typeof createMockExam>>;
          try {
            c = await createMockExam(meta);
          } catch (e: any) {
            setMsg("시험을 만들지 못했습니다: " + String(e?.message ?? e));
            setStep("");
            return;
          }
          if (!c.ok) {
            setMsg(c.msg);
            setStep("");
            return;
          }
          // 다 올렸으면 ?new=1 — 시험 화면이 그때만 AI(정답 읽기·해설 위치 찾기)를 저절로 돌린다(MockCsatPanel autoAi)
          const go = (err?: string) =>
            router.push(`/exams/${encodeURIComponent(c.code)}` + (err ? `?aiErr=${encodeURIComponent(err.slice(0, 200))}` : "?new=1"));
          try {
            setStep("문제지 올리는 중…");
            const p1 = pdfTooLarge(prob) ? (await fitPdfForUpload(prob, setStep)).file : prob;
            await uploadPdfDirect(c.id, p1);
            const a = await finalizeAttachExamPdfOnly(c.code);
            if (!a.ok) throw new Error("문제지: " + (a.msg ?? "저장 실패"));
            setStep("해설지 올리는 중…");
            const p2 = pdfTooLarge(sol) ? (await fitPdfForUpload(sol, setStep)).file : sol;
            const path = await uploadSolutionPdfDirect(c.id, p2);
            const b = await finalizeSolutionPdf(c.code, path);
            if (!b.ok) throw new Error("해설지: " + b.msg);
          } catch (e: any) {
            go("파일 올리기 실패 — 시험 화면에서 다시 올려 주세요: " + String(e?.message ?? e));
            return;
          }
          setStep("시험 화면으로 이동…");
          go();
        });
      }}
    >
      <div>
        <label className="label">시험 이름</label>
        <input name="name" className="input" placeholder="2026 10월 ○○ 사설 모의고사 고3 수학" required />
      </div>
      <div>
        <label className="label">시험 코드 (비우면 자동)</label>
        <input name="code" className="input" placeholder="예: mock2610-a" />
      </div>
      <div>
        <label className="label">문제지 PDF</label>
        <PdfDropInput name="problem" required compact />
      </div>
      <div>
        <label className="label">해설지 PDF</label>
        <PdfDropInput name="solution" required compact />
      </div>
      <p className="text-xs text-slate-500">
        공통 1~22번 + 선택과목(확률과 통계·미적분·기하) 23~30번. 학생은 제출할 때 자기 선택과목을 고릅니다. 정답은 다음 화면에서 AI가 해설지를 읽어
        채워 두니 확인 후 저장하세요.
      </p>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? step || "처리하는 중…" : "모의고사 만들기"}
      </button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </form>
  );
}
