"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enqueueAllQrScansAction } from "./actions";
import { actionErrorMessage } from "@/lib/actionError";

export type QrSummary = {
  available: boolean;
  pdfExams: number;
  done: number;
  withQr: number;
  qrCount: number;
  pending: number;
  error: number;
  notScanned: number;
};

// 2026-09-29: 원본 속 QR 가리기 — 진행 현황과 "아직 안 찾은 시험 모두 찾기"(관리자)
export default function QrScanPanel({ s }: { s: QrSummary }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  if (!s.available) {
    return (
      <div className="space-y-1">
        <h2 className="font-medium">원본 속 QR 가리기</h2>
        <p className="text-sm text-slate-500">마이그레이션 0031을 실행하면 여기서 진행 상황을 볼 수 있습니다.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">원본 속 QR 가리기</h2>
        <button className="btn-secondary py-1 px-3 text-xs" disabled={pending} onClick={() => router.refresh()}>
          새로고침
        </button>
      </div>
      <p className="text-sm text-slate-500">
        시험지 원본에 인쇄된 QR(학교·다른 학원 등)을 AI가 찾아 두고, 학생 배포용·과외선생님 다운로드 PDF에서 흰 칸으로
        가립니다. 원본 파일은 그대로입니다. 새로 올린 시험은 AI 처리가 끝나면 자동으로 찾습니다.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="badge bg-emerald-100 text-emerald-700">찾기 끝 {s.done}개</span>
        <span className="badge bg-slate-100 text-slate-700">
          QR 있는 시험 {s.withQr}개 · QR {s.qrCount}개
        </span>
        {s.pending > 0 && <span className="badge bg-sky-100 text-sky-700">찾는 중 {s.pending}개</span>}
        {s.notScanned > 0 && <span className="badge bg-amber-100 text-amber-800">아직 안 찾음 {s.notScanned}개</span>}
        {s.error > 0 && <span className="badge bg-red-100 text-red-700">오류 {s.error}개</span>}
      </div>
      {(s.notScanned > 0 || s.error > 0) && (
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const r = await enqueueAllQrScansAction();
                setMsg(r.msg);
                router.refresh();
              } catch (e) {
                setMsg(actionErrorMessage(e).text);
              }
            })
          }
        >
          {pending ? "거는 중…" : `아직 안 찾은 시험 ${s.notScanned + s.error}개 모두 찾기`}
        </button>
      )}
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
