/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 시험지 PDF를 서버 액션(FormData)으로 직접 올리므로 기본 1MB 제한을 늘려 둔다.
  // (lib/ai 쪽에서도 45MB로 다시 한 번 막아 둠 — Vercel 함수 자체의 요청 본문 한도도 이 값 안쪽이어야 함.)
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // @napi-rs/canvas는 실제 그림을 그리는 부분이 네이티브 바이너리(.node)라서, webpack이
    // 이걸 평범한 JS인 줄 알고 번들에 넣으려다 "Module parse failed: Unexpected character"로
    // 빌드가 깨진다. 서버 전용 패키지로 지정해 두면 번들에 넣지 않고 런타임에 그냥
    // require()해서 쓰게 되므로 이 문제가 사라진다(Next 14.2용 옵션 이름).
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
  },
  // 표지·정오표·QR 쪽을 그림으로 그릴 때 쓰는 한글 폰트(assets/fonts/*.otf)와 학원 로고
  // (assets/branding/logo.png)를 Vercel 서버리스 함수 번들에 확실히 포함시킨다
  // (fs.readFile의 동적 경로는 자동 파일 추적(nft)이 놓칠 수 있어 명시적으로 지정).
  outputFileTracingIncludes: {
    "/exams/[code]/pdf": ["./assets/fonts/**", "./assets/branding/**"],
  },
};

export default nextConfig;
