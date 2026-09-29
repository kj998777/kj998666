"use client";

import { useState, useTransition } from "react";
import { saveKakaoContact } from "./actions";

// 대기 화면에 띄울 원장님 카카오톡 오픈채팅(2026-09-29 원장님 요청: 오픈채팅으로 받기). 링크만 넣으면 QR은 대기 화면이 자동으로 만들고,
// 따로 QR 그림을 올려도 된다
// (브라우저에서 한 변 480px로 줄여 data: URL로 저장 — 따로 저장소 버킷이 필요 없음).
type Contact = { kakao_id: string; kakao_url: string; kakao_qr: string; note: string };

async function shrinkToDataUrl(file: File, max = 480): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("그림을 열지 못했습니다."));
      img.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");
    return png.length < 350000 ? png : c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function KakaoContactForm({ initial }: { initial: Contact }) {
  const [v, setV] = useState<Contact>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value });
    setMsg(null);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_12rem]">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="kk-url">
            카카오톡 오픈채팅 링크
          </label>
          <input id="kk-url" className="input" value={v.kakao_url} onChange={set("kakao_url")} placeholder="예: https://open.kakao.com/o/sAbCdEf" maxLength={300} />
          <p className="text-xs text-slate-400 mt-1">
            카카오톡 → 오픈채팅 → 1:1 채팅방 만들기(또는 내 오픈채팅방) → 공유 → 링크 복사해서 붙여 넣으세요. 대기 화면에 &ldquo;오픈채팅으로 보내기&rdquo;
            버튼과 이 링크로 만든 QR이 보입니다.
          </p>
          {v.kakao_url && !/open\.kakao\.com\//i.test(v.kakao_url) && (
            <p className="text-xs text-amber-700 mt-1">오픈채팅 링크는 보통 open.kakao.com/o/… 모양입니다. 링크가 맞는지 확인해 주세요.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="kk-id">
            카카오톡 ID (선택)
          </label>
          <input id="kk-id" className="input" value={v.kakao_id} onChange={set("kakao_id")} placeholder="오픈채팅 대신 ID로 친구 추가할 때" maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="kk-note">
            덧붙일 말 (선택)
          </label>
          <input id="kk-note" className="input" value={v.note} onChange={set("note")} placeholder="예: 참여 코드 1234 / 들어와서 위 내용을 보내 주세요" maxLength={300} />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-primary"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const r = await saveKakaoContact(v).catch((e: any) => ({ ok: false, msg: String(e?.message || e) }));
                setMsg(r.ok ? { ok: true, text: "저장했습니다. 대기 화면에 바로 보입니다." } : { ok: false, text: (r as any).msg || "저장하지 못했습니다." });
              })
            }
          >
            {pending ? "저장하는 중…" : "저장"}
          </button>
          {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</span>}
        </div>
      </div>
      <div className="space-y-2">
        <span className="label">QR 그림 (선택 — 없으면 링크로 자동 생성)</span>
        {v.kakao_qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.kakao_qr} alt="카카오톡 QR" className="w-40 h-40 object-contain border border-slate-200 rounded" />
        ) : (
          <div className="w-40 h-40 border border-dashed border-slate-300 rounded flex items-center justify-center text-xs text-slate-400 text-center px-2">
            비워 두면 오픈채팅 링크로 QR을 자동으로 만들어 보여 줍니다
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary text-xs py-1 px-2 cursor-pointer">
            {v.kakao_qr ? "바꾸기" : "올리기"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.currentTarget.value = "";
                if (!f) return;
                try {
                  const d = await shrinkToDataUrl(f);
                  setV((x) => ({ ...x, kakao_qr: d }));
                  setMsg(null);
                } catch (err: any) {
                  setMsg({ ok: false, text: err?.message || "그림을 열지 못했습니다." });
                }
              }}
            />
          </label>
          {v.kakao_qr && (
            <button className="text-xs text-red-600 hover:underline" onClick={() => setV((x) => ({ ...x, kakao_qr: "" }))}>
              빼기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
