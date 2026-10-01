import StudentSubmitForm from "@/app/s/[code]/StudentSubmitForm";
import { loadTestByCode } from "@/lib/placement/server";

// 입학테스트 학생 제출 화면(0047) — 시험지 마지막 쪽 QR이 여기로 온다. 로그인 없음.
// 정답은 화면으로 보내지 않는다(문항 번호·객관식/주관식만). 채점은 /api/placement-submit/<코드>가 한다.
export const dynamic = "force-dynamic";

export default async function PlacementSubmitPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).toUpperCase();
  const found = await loadTestByCode(code);
  if (!found) return <Wrap>입학테스트를 찾을 수 없습니다. 받은 링크를 다시 확인해 주세요.</Wrap>;
  const { test, details } = found;
  if (!test.is_open) {
    return (
      <Wrap>
        <strong>{test.title || "입학테스트"}</strong>는 지금 제출을 받지 않습니다.
        <div className="text-slate-500 text-sm mt-1">선생님께 문의해 주세요.</div>
      </Wrap>
    );
  }
  return (
    <StudentSubmitForm
      code={test.code}
      examName={test.title || "입학테스트"}
      classes={[]}
      endpoint={`/api/placement-submit/${encodeURIComponent(test.code)}`}
      items={details.map((d, i) => ({ item_label: String(i + 1), type: d.type === "객관식" ? "객관식" : "주관식" }))}
    />
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-sm text-center text-sm">{children}</div>
    </div>
  );
}
