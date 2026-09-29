"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { compressImage, MAX_UPLOAD_BYTES } from "@/lib/image/compress";
import { actionErrorMessage } from "@/lib/actionError";
import { useRouter } from "next/navigation";
import { submitPrimaryReview, submitVerification, releaseReviewClaim, claimNextReviewItem } from "../actions";
import { MathPreview, MathToolbar } from "@/app/_components/MathTools";

// 정답·풀이 칸의 수식 도구(2026-09-29): 관리자 화면과 같은 MathToolbar(분수·루트·경우 나누기 같은 수식 틀과 기호)와
// MathPreview(적은 수식이 해설·PDF에 보일 모양)를 쓴다. 예전의 기호 버튼(√, π, ² …)을 대신한다.
// 새 문항(primary)과 사후 검증(verify) 제출을 같은 폼으로 처리한다 — 화면도, 입력 방식도 완전히
// 동일해야 검증자가 "이건 검증용이구나"를 눈치채지 못한다(블라인드 검증의 핵심).
const MIN_SOLUTION_CHARS = 10; // actions.ts와 같은 값

export default function SubmissionForm({
  itemExplanationId,
  kind,
}: {
  itemExplanationId: string;
  kind: "primary" | "verify";
}) {
  const router = useRouter();
  const [answerDisplay, setAnswerDisplay] = useState("");
  const [solution, setSolution] = useState("");
  const answerRef = useRef<HTMLInputElement | null>(null);
  const solutionRef = useRef<HTMLTextAreaElement | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  // 풀이 필수(2026-09-29): 풀이 글 MIN_SOLUTION_CHARS자 이상 또는 풀이 사진 — 서버(actions.ts)에서도 같은 검사
  const needSolution = solution.trim().length < MIN_SOLUTION_CHARS && !image;
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [result, setResult] = useState<{ pointsEarned: number; isMatch?: boolean } | null>(null);
  const [nextMsg, setNextMsg] = useState("");

  // 2026-09-29: 휴대폰에서 다른 앱에 갔다 오면 화면이 새로 열리며 적던 답·풀이가 사라졌다 → 이 기기에 임시 저장해 두고 되살린다.
  const draftKey = `mc-review-draft:${itemExplanationId}`;
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d?.a === "string") setAnswerDisplay(d.a);
        if (typeof d?.s === "string") setSolution(d.s);
        if (d?.a || d?.s) setRestored(true);
      }
    } catch {
      /* 저장소를 못 쓰는 환경이면 그냥 넘어감 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    try {
      if (answerDisplay || solution) localStorage.setItem(draftKey, JSON.stringify({ a: answerDisplay, s: solution, t: Date.now() }));
    } catch {
      /* 무시 */
    }
  }, [draftKey, answerDisplay, solution]);
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* 무시 */
    }
  }

  // "다음 문항 받기"/"포기하고 다른 문항 받기" 공통 로직 — 큐 페이지로 보내고 사용자가 버튼을 한
  // 번 더 누르게 하지 않고, 여기서 바로 claimNextReviewItem을 불러 배정된 문항으로 즉시 이동한다.
  function goToNextItem() {
    start(async () => {
      setNextMsg("");
      try {
        const next = await claimNextReviewItem();
        if (!next) {
          setNextMsg("지금은 검토할 문항이 없습니다. 나중에 다시 확인해 주세요.");
          return;
        }
        if ("error" in next) {
          setNextMsg(next.error);
          return;
        }
        router.push(`/tutor/review/${next.itemExplanationId}?kind=${next.kind}`);
      } catch (e: any) {
        setNextMsg(e?.message ?? "문항을 배정받지 못했습니다.");
      }
    });
  }

  async function handleImageChange(raw: File | null) {
    // 큰 휴대폰 사진은 서버 한도(약 4.5MB)를 넘겨 제출이 실패했으므로 올리기 전에 줄인다(lib/image/compress.ts)
    const file = raw ? await compressImage(raw) : null;
    // 줄여도 너무 크면(브라우저가 못 여는 형식 등) 보내다 실패하므로 미리 막는다
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setErr("이 사진은 용량이 너무 커서 올릴 수 없어요. 다른 사진을 고르거나 화면을 캡처해서 올려 주세요.");
      return;
    }
    setErr("");
    setImage(file);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  if (result) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-emerald-600 font-medium">제출 완료! +{result.pointsEarned}P 적립됐습니다.</p>
        {kind === "verify" && (
          <p className="text-sm text-slate-500">
            {result.isMatch
              ? "원 제출과 일치했습니다."
              : "원 제출과 일치하지 않아 관리자 확인이 필요합니다."}
          </p>
        )}
        <button className="btn-primary" disabled={pending} onClick={goToNextItem}>
          다음 문항 받기
        </button>
        {nextMsg && <p className="text-sm text-slate-500">{nextMsg}</p>}
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      {restored && (
        <p className="text-xs text-emerald-700">
          이 기기에 임시 저장해 둔 답·풀이를 불러왔습니다(사진은 다시 올려 주세요).
        </p>
      )}
      <div>
        <label className="label">정답</label>
        <input
          ref={answerRef}
          className="input"
          value={answerDisplay}
          onChange={(e) => setAnswerDisplay(e.target.value)}
          placeholder="예: 3 또는 12.5 또는 3/4 (분수·루트는 아래 버튼)"
        />
        <MathToolbar target={answerRef} value={answerDisplay} onChange={setAnswerDisplay} circled />
        <MathPreview text={answerDisplay} className="mt-1" />
      </div>
      <div>
        <label className="label">
          풀이 <span className="font-normal text-rose-600">(글 또는 사진 중 하나는 꼭 필요)</span>
        </label>
        <MathToolbar target={solutionRef} value={solution} onChange={setSolution} />
        <textarea
          ref={solutionRef}
          className="input min-h-32 mt-1"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이 과정을 적어 주세요. 위 버튼으로 분수·루트·경우 나누기 같은 수식을 넣을 수 있습니다."
        />
        <MathPreview text={solution} className="mt-2" />
      </div>
      <div>
        <label className="label">풀이 사진</label>
        <p className="text-xs text-slate-500 mb-1">
          손으로 쓴 풀이를 사진으로 찍거나, 앨범에 있는 사진·화면 캡처를 골라 올려도 됩니다. 자동으로 정리·디지털화되지
          않고, 올린 사진 그대로 저장됩니다.
        </p>
        {/* 2026-09-29: capture 속성 때문에 휴대폰에서 카메라만 열리고 앨범·캡처 사진을 고를 수 없었다 →
            "사진 찍기"(카메라 바로 열기)와 "앨범에서 고르기"(사진 보관함·파일) 두 버튼으로 나눴다. */}
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer">
            사진 찍기
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                handleImageChange(e.target.files?.[0] ?? null);
                e.currentTarget.value = ""; // 같은 사진을 다시 골라도 반영되게
              }}
            />
          </label>
          <label className="btn-secondary cursor-pointer">
            앨범에서 고르기
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                handleImageChange(e.target.files?.[0] ?? null);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {imagePreviewUrl && (
          <div className="mt-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreviewUrl} alt="첨부한 풀이 사진 미리보기" className="max-h-40 rounded border border-slate-200" />
            <button type="button" className="btn-secondary" onClick={() => handleImageChange(null)}>
              사진 제거
            </button>
          </div>
        )}
      </div>
      {err && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{err}</p>
          {needsReload && (
            <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
              새로고침
            </button>
          )}
        </div>
      )}
      {needSolution && (
        <p className="text-sm text-amber-700">
          풀이를 {MIN_SOLUTION_CHARS}자 이상 적거나 풀이 사진을 올려야 제출할 수 있어요.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending || !answerDisplay.trim() || needSolution}
          onClick={() =>
            start(async () => {
              setErr("");
              setNeedsReload(false);
              // 2026-09-29: 서버 액션이 예외를 던지면(새 배포 직후 옛 화면, 연결 끊김, 용량 초과 등) 흰 "Application error"
              // 화면이 떴다 → 잡아서 안내 문구로 보여 주고, 적던 답·풀이는 그대로 둔다.
              let r: { ok: boolean; msg?: string; pointsEarned?: number; isMatch?: boolean };
              try {
                r =
                  kind === "verify"
                    ? await submitVerification(itemExplanationId, answerDisplay, solution, image)
                    : await submitPrimaryReview(itemExplanationId, answerDisplay, solution, image);
              } catch (e) {
                console.error("review submit failed", e);
                const m = actionErrorMessage(e);
                setErr(m.text);
                setNeedsReload(m.needsReload);
                return;
              }
              if (!r || !r.ok) {
                setErr(r?.msg ?? "제출하지 못했습니다.");
                return;
              }
              clearDraft();
              setResult({
                pointsEarned: r.pointsEarned ?? 0,
                isMatch: r.isMatch,
              });
            })
          }
        >
          제출
        </button>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await releaseReviewClaim(itemExplanationId);
              } catch (e) {
                const m = actionErrorMessage(e);
                setErr(m.text);
                setNeedsReload(m.needsReload);
                return;
              }
              clearDraft();
              goToNextItem();
            })
          }
        >
          포기하고 다른 문항 받기
        </button>
      </div>
      {nextMsg && <p className="text-sm text-slate-500">{nextMsg}</p>}
    </div>
  );
}
