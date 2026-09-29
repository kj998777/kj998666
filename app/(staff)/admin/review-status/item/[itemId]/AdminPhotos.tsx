"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/image/compress";
import { adminDeleteItemPhoto, adminUploadItemPhoto } from "../../actions";

/** 관리자 풀이 사진: 올리기(휴대폰 사진은 줄여서) · 보기 · 지우기 */
export default function AdminPhotos({ itemId, names }: { itemId: string; names: string[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = (files: FileList | null) =>
    start(async () => {
      setMsg(null);
      if (!files || !files.length) return;
      let okN = 0;
      for (const raw of Array.from(files).slice(0, 5)) {
        const file = await compressImage(raw);
        const fd = new FormData();
        fd.append("photo", file);
        const r = await adminUploadItemPhoto(itemId, fd);
        if (!r.ok) {
          setMsg({ ok: false, text: r.msg ?? "올리지 못했습니다." });
          break;
        }
        okN++;
      }
      if (okN) setMsg({ ok: true, text: `사진 ${okN}장을 올렸습니다.` });
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">내 풀이 사진</h2>
        <label className="btn-secondary cursor-pointer">
          {pending ? "올리는 중…" : "사진 올리기"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={pending}
            onChange={(e) => upload(e.target.files)}
          />
        </label>
      </div>
      {names.length === 0 ? (
        <p className="text-sm text-slate-400">아직 올린 사진이 없습니다. 손으로 푼 풀이를 찍어 올려 두면 이 문항 화면에서 언제든 볼 수 있습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {names.map((n) => {
            const src = `/admin/review-status/item/${itemId}/photo?name=${encodeURIComponent(n)}`;
            return (
              <div key={n} className="space-y-1">
                <a href={src} target="_blank" rel="noreferrer">
                  <img src={src} alt="관리자 풀이 사진" className="h-40 w-auto rounded border border-slate-200 bg-white" />
                </a>
                <button
                  type="button"
                  className="text-xs text-red-600 underline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await adminDeleteItemPhoto(itemId, n);
                      if (!r.ok) setMsg({ ok: false, text: r.msg ?? "지우지 못했습니다." });
                      router.refresh();
                    })
                  }
                >
                  지우기
                </button>
              </div>
            );
          })}
        </div>
      )}
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
