import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getAiSettingsPublic, getCreditInfo } from "@/lib/ai/settings";
import AiSettingsForm from "./AiSettingsForm";
import CreditPanel from "./CreditPanel";

export default async function AdminAiPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [settings, credit] = await Promise.all([getAiSettingsPublic(supabase), getCreditInfo(supabase)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">AI 설정</h1>
        <p className="text-sm text-slate-500">
          시험지 자동 처리(문항 추출·풀이·검수)에 쓰는 Anthropic API 키·모델과 크레딧 사용량을 관리합니다.
        </p>
      </div>

      <div className="card max-w-lg">
        <h2 className="font-medium mb-3">API 키 · 모델</h2>
        <AiSettingsForm initial={settings} />
      </div>

      <div className="card max-w-lg">
        <h2 className="font-medium mb-3">크레딧 사용량</h2>
        <CreditPanel initial={credit} />
      </div>
    </div>
  );
}
