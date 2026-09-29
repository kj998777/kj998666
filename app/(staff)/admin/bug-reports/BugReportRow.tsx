"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BUG_STATUSES, BUG_STATUS_BADGE } from "@/lib/bugs";
import { updateBugReport } from "./actions";

export type AdminBugRow = {
  id: string;
  reporter: string;
  category: string;
  title: string;
  body: string;
  page_hint: string | null;
  user_agent: string | null;
  has_photo: boolean;
  status: string;
  admin_note: string | null;
  created: string;
};

export default function BugReportRow({ r }: { r: AdminBugRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(r.status);
  const [note, setNote] = useState(r.admin_note ?? "");
  const [msg, setMsg] = useState("");
  const dirty = status !== r.status || note !== (r.admin_note ?? "");

  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{r.title}</div>
          <div className="text-xs text-slate-500">
            {r.reporter} · {r.category} · {r.created}
            {r.page_hint ? ` · ${r.page_hint}` : ""}
          </div>
        </div>
        <span className={"badge " + (BUG_STATUS_BADGE[r.status] ?? "bg-slate-100 text-slate-600")}>{r.status}</span>
      </div>
      <p className="text-sm text-slate-800 whitespace-pre-wrap">{r.body}</p>
      {r.has_photo && (
        <a href={`/bug-photo/${r.id}`} target="_blank" rel="noreferrer" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/bug-photo/${r.id}`} alt="첨부한 스크린샷" className="max-h-56 rounded border border-slate-200" loading="lazy" />
        </a>
      )}
      {r.user_agent && <p className="text-[11px] text-slate-400 break-all">기기: {r.user_agent}</p>}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {BUG_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={
                "rounded-full border px-3 py-1 text-xs " +
                (status === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700")
              }
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          className="input text-sm"
          style={{ minHeight: 70 }}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="답변(선택) — 신고한 선생님 화면에 그대로 보입니다."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary py-1 px-3 text-sm"
            disabled={pending || !dirty}
            onClick={() =>
              start(async () => {
                setMsg("");
                const res = await updateBugReport(r.id, status, note);
                if (!res.ok) setMsg(res.msg);
                else router.refresh();
              })
            }
          >
            {pending ? "저장 중…" : "저장"}
          </button>
          {msg && <span className="text-sm text-red-600">{msg}</span>}
        </div>
      </div>
    </li>
  );
}
