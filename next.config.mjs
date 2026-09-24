/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 시험지 PDF를 서버 액션(FormData)으로 직접 올리므로 기본 1MB 제한을 늘려 둔다.
  // (lib/ai 쪽에서도 45MB로 다시 한 번 막아 둠 — Vercel 함수 자체의 요청 본문 한도도 이 값 안쪽이어야 함.)
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
