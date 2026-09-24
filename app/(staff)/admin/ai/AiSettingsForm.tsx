"use client";

import { useState, useTransition } from "react";
import { clearAiKeyAction, saveAiSettingsAction } from "./actions";
import type { AiSettingsPublic } from "@/lib/ai/settings";

export default function AiSettingsForm({ initial }: { initial: AiSettingsPublic }) {
  const [settings, setSettings] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {settings.hasKey ? (
          <>현재 저장된 키: <code className="bg-slate-100 px-1 rounded">••••{settings.tail}</code></>
        ) : (
          "아직 API 키가 저장되어 있지 않습니다."
        )}
      </p>
      <form
        className="space-y-3"
        action={(formData) => {
          setMsg(null);
          start(async () => {
            const r = await saveAiSettingsAction(formData);
            if (r.ok) {
              setSettings(r.settings);
              setMsg({ ok: true, text: "저장했습니다." });
            } else {
              setMsg({ ok: false, text: r.msg });
            }
          });
        }}
      >
        <div>
          <label className="label" htmlFor="api_key">
            Anthropic API 키 (새로 바꿀 때만 입력)
          </label>
          <input id="api_key" name="api_key" type="password" className="input" placeholder="sk-ant-..." />
        </div>
        <div>
          <label className="label" htmlFor="model">
            모델
          </label>
          <select id="model" name="model" className="input" defaultValue={settings.model}>
            {settings.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "확인하는 중…" : "저장"}
          </button>
          {settings.hasKey && (
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await clearAiKeyAction();
                  setSettings(r.settings);
                  setMsg({ ok: true, text: "키를 지웠습니다." });
                })
              }
            >
              키 지우기
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
