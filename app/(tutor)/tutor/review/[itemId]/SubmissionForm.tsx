"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { compressImage } from "@/lib/image/compress";
import { useRouter } from "next/navigation";
import { submitPrimaryReview, submitVerification, releaseReviewClaim, claimNextReviewItem } from "../actions";

// 정답·풀이 칸에서 키보드로 치기 힘든 수학 기호를 버튼 클릭으로 커서 위치에 끼워 넣는다.
// (특수기호를 아예 못 적어 "3의 세제곱근" 처럼 풀어 써야 했던 불편을 없앤다.)
const MATH_SYMBOLS = [
  "√", "²", "³", "±", "×", "÷", "≤", "≥", "≠", "≈",
  "∵", "∴", "π", "°", "∞", "∠", "△", "∑", "∫", "→",
];

function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  set: (v: string) => void,
  symbol: string
) {
  if (!el) {
    set(current + symbol);
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  set(current.slice(0, start) + symbol + current.slice(end));
  // 값이 바뀌면 커서가 리셋되므로, 리렌더 다음 프레임에 원하는 위치로 다시 옮겨 준다.
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + symbol.length;
    el.setSelectionRange(pos, pos);
  });
}

function SymbolToolbar({ onPick }: { onPick: (symbol: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {MATH_SYMBOLS.map((s) => (
        <button
          key={s}
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-sm hover:bg-slate-50"
          onClick={() => onPick(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// 새 문항(primary)과 사후 검증(verify) 제출을 같은 폼으로 처리한다 — 화면도, 입력 방식도 완전히
// 동일해야 검증자가 "이건 검증용이구나"를 눈치채지 못한다(블라인드 검증의 핵심).
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
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
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
          placeholder="예: 3 또는 12.5 또는 3/4"
        />
        <SymbolToolbar onPick={(s) => insertAtCursor(answerRef.current, answerDisplay, setAnswerDisplay, s)} />
      </div>
      <div>
        <label className="label">풀이 (선택)</label>
        <textarea
          ref={solutionRef}
          className="input min-h-32"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          placeholder="풀이 과정을 적어 주세요."
        />
        <SymbolToolbar onPick={(s) => insertAtCursor(solutionRef.current, solution, setSolution, s)} />
      </div>
      <div>
        <label className="label">풀이 사진 (선택)</label>
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
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={pending || !answerDisplay.trim()}
          onClick={() =>
            start(async () => {
              setErr("");
              const r =
                kind === "verify"
                  ? await submitVerification(itemExplanationId, answerDisplay, solution, image)
                  : await submitPrimaryReview(itemExplanationId, answerDisplay, solution, image);
              if (!r.ok) {
                setErr(r.msg ?? "제출하지 못했습니다.");
                return;
              }
              clearDraft();
              setResult({
                pointsEarned: r.pointsEarned,
                isMatch: "isMatch" in r ? (r as { isMatch: boolean }).isMatch : undefined,
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
              await releaseReviewClaim(itemExplanationId);
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
