"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { compressImage, MAX_UPLOAD_BYTES } from "@/lib/image/compress";
import { actionErrorMessage } from "@/lib/actionError";
import { BUG_CATEGORIES } from "@/lib/bugs";
import { submitBugReport } from "./actions";

// 과외선생님 버그 신고 양식(2026-09-29). 적던 내용은 이 기기에 임시 저장해 두어 다른 앱에 갔다 와도 남는다.
const DRAFT_KEY = "mc-bug-draft";

export default function BugReportForm({ defaultPage }: { defaultPage?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<string>(BUG_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pageHint, setPageHint] = useState(defaultPage ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.c) setCategory(d.c);
        if (d.t) setTitle(d.t);
        if (d.b) setBody(d.b);
        if (d.p && !defaultPage) setPageHint(d.p);
      }
    } catch {
      /* 무시 */
    }
  }, [defaultPage]);

  useEffect(() => {
    try {
      if (title || body) localStorage.setItem(DRAFT_KEY, JSON.stringify({ c: category, t: title, b: body, p: pageHint }));
    } catch {
      /* 무시 */
    }
  }, [category, title, body, pageHint]);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(photo);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("category", category);
      fd.set("title", title);
      fd.set("body", body);
      fd.set("page_hint", pageHint);
      fd.set("user_agent", typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : "");
      if (photo) {
        const small = await compressImage(photo);
        if (small.size > MAX_UPLOAD_BYTES) {
          setMsg({ ok: false, text: "사진 용량이 너무 커서 보낼 수 없어요. 다른 사진을 고르거나 화면을 캡처해서 올려 주세요." });
          return;
        }
        fd.set("photo", small);
      }
      // 예외(새 배포 직후 옛 화면, 연결 끊김 등)가 흰 오류 화면으로 번지지 않게 잡는다(2026-09-29)
      let r: Awaited<ReturnType<typeof submitBugReport>>;
      try {
        r = await submitBugReport(fd);
      } catch (e) {
        console.error("bug report submit failed", e);
        setMsg({ ok: false, text: actionErrorMessage(e).text.replace("적어 둔 답·풀이 글은", "적어 둔 내용은") });
        return;
      }
      if (!r.ok) {
        setMsg({ ok: false, text: r.msg });
        return;
      }
      setMsg({ ok: true, text: "신고가 접수됐습니다. 원장님이 확인하면 아래 목록에 처리 상태와 답변이 표시됩니다." });
      setTitle("");
      setBody("");
      setPageHint("");
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* 무시 */
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <label className="label">종류</label>
        <div className="flex flex-wrap gap-2">
          {BUG_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={
                "rounded-full border px-3 py-1 text-sm " +
                (category === c ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700")
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="bug-title">
          제목
        </label>
        <input
          id="bug-title"
          className="input"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 문제 이미지가 다른 번호로 나와요"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="bug-page">
          어느 화면·시험·문항에서? (선택)
        </label>
        <input
          id="bug-page"
          className="input"
          maxLength={300}
          value={pageHint}
          onChange={(e) => setPageHint(e.target.value)}
          placeholder="예: 검토하기 · 남녕고 1-1 기말 2025 · 12번"
        />
      </div>
      <div>
        <label className="label" htmlFor="bug-body">
          무슨 일이 있었나요?
        </label>
        <textarea
          id="bug-body"
          className="input"
          style={{ minHeight: 140 }}
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"무엇을 눌렀을 때 → 어떻게 됐는지 → 원래는 어떻게 돼야 하는지 순서로 적어 주시면 빨리 고칠 수 있어요."}
          required
        />
      </div>
      <div>
        <label className="label">스크린샷 (선택)</label>
        <p className="text-xs text-slate-500 mb-1">화면을 캡처해서 올려 주시면 원인을 찾기 훨씬 쉽습니다. 큰 사진은 자동으로 줄여서 올라갑니다.</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {preview && (
          <div className="mt-2 flex items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="첨부한 스크린샷 미리보기" className="max-h-40 rounded border border-slate-200" />
            <button
              type="button"
              className="text-xs text-slate-500 underline"
              onClick={() => {
                setPhoto(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              사진 제거
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending || !title.trim() || body.trim().length < 5}>
          {pending ? "보내는 중…" : "신고 보내기"}
        </button>
        {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
      </div>
    </form>
  );
}
