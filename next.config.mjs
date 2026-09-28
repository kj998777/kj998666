/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // #2(2026-09-28) 이전에는 시험지 PDF를 서버 액션(FormData)으로 직접 올려서 기본 1MB 제한을 늘려
  // 둬야 했다. 지금은 PDF 바이트가 브라우저→Supabase Storage 직접 업로드로 바뀌어(최대 20MB,
  // lib/supabase/uploadPdf.ts) 이 값을 실제로 채울 일은 없어졌지만, 다른 서버 액션이 큰 폼을 받을
  // 가능성에 대비해 값은 그대로 넉넉하게 남겨 둔다(어차피 Vercel 함수 자체의 요청 본문 한도, 약
  // 4.5MB가 실질적인 상한이라 이 설정 자체가 병목이었던 적은 없음).
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
