"use client";

// 맨 바깥 레이아웃에서 난 오류까지 받아 주는 마지막 안전망(app/error.tsx가 못 잡는 경우). 2026-09-29.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "64px 16px", textAlign: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>화면을 불러오는 중 문제가 생겼어요</h1>
        <p style={{ fontSize: 14, color: "#475569" }}>새로고침 후 다시 시도해 주세요. 계속되면 원장님께 알려 주세요.</p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, background: "#0f172a", color: "#fff", border: 0 }}
        >
          새로고침
        </button>
        {error?.digest && <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 12 }}>오류 번호: {error.digest}</p>}
      </body>
    </html>
  );
}
