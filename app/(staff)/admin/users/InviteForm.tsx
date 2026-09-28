"use client";

import { useState, useTransition } from "react";
import { inviteUser } from "./actions";

export default function InviteForm({ defaultRole = "viewer" }: { defaultRole?: "viewer" | "tutor" }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setMsg(null);
        start(async () => {
          const r = await inviteUser(formData);
          setMsg({ ok: r.ok, text: r.msg ?? (r.ok ? "초대했습니다." : "실패했습니다.") });
        });
      }}
    >
      <div>
        <label className="label" htmlFor="email">
          이메일
        </label>
        <input id="email" name="email" type="email" required className="input" placeholder="junior@example.com" />
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <div>
          <label className="label" htmlFor={`cohort-${defaultRole}`}>
            기수 (선택)
          </label>
          <input id={`cohort-${defaultRole}`} name="cohort" maxLength={10} className="input" placeholder="예: 31" />
        </div>
        <div>
          <label className="label" htmlFor={`display_name-${defaultRole}`}>
            이름 (선택)
          </label>
          <input id={`display_name-${defaultRole}`} name="display_name" maxLength={30} className="input" placeholder="홍길동" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="role">
          권한
        </label>
        <select id="role" name="role" className="input" defaultValue={defaultRole}>
          <option value="viewer">뷰어 (조회만)</option>
          <option value="editor">편집자 (시험·정답·반 관리)</option>
          <option value="admin">관리자 (전체 권한)</option>
          <option value="tutor">과외선생님 (검토·기출다운로드)</option>
        </select>
      </div>
      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "보내는 중…" : "초대 메일 보내기"}
      </button>
    </form>
  );
}
