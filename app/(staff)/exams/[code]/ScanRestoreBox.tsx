"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { restoreScanPdfAction } from "./digitize-actions";
import { pdfTooLarge, uploadScanRestoreDirect } from "@/lib/supabase/uploadPdf";

// 2026-09-29: 예전에 '원본으로 적용'하면서 스캔본이 지워진 시험 — 처음 올렸던 스캔 PDF만 다시 넣으면
// 디지털화를 다시 하지 않고도 그림 다시 오리기·그림 자리 직접 고치기가 된다.
export default function ScanRestoreBox({ code, examId }: { code: string; examId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onFile(f: File) {
    setMsg(null);
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return setMsg({ ok: false, text: "PDF 파일을 골라 주세요." });
    if (pdfTooLarge(f)) return setMsg({ ok: false, text: "20MB보다 큰 PDF는 올릴 수 없습니다." });
    setBusy(true);
    try {
      const path = await uploadScanRestoreDirect(examId, f);
      const r: any = await restoreScanPdfAction(code, path);
      if (!r.ok) throw new Error(r.msg || "넣지 못했습니다.");
      setMsg({ ok: true, text: `스캔본(${r.pages}쪽)을 넣었습니다. 이제 그림 다시 오리기·그림 자리 직접 고치기를 쓸 수 있어요.` });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
      <p className="text-amber-900">
        이 시험은 예전에 &lsquo;원본으로 적용&rsquo;하면서 스캔본이 지워져서, 그림을 다시 오리거나 그림 자리를 고칠 수 없습니다.
        <b> 처음 디지털화할 때 올렸던 스캔 PDF</b>만 다시 넣어 주세요. 디지털화는 다시 하지 않아도 되고, 지금 원본(디지털 시험지)도 그대로입니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary text-sm px-3 py-1" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "넣는 중…" : "스캔본 다시 올리기"}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = "";
            if (f) onFile(f);
          }}
        />
      </div>
      {msg && <p className={msg.ok ? "text-emerald-700" : "text-red-600"}>{msg.text}</p>}
    </div>
  );
}
