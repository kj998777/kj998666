// 파일 다운로드 응답의 Content-Disposition 헤더를 안전하게 만든다.
//
// 버그였던 부분: exam.code는 배치 업로드 시 파일명(한글 포함)을 그대로 슬러그 처리 없이 써서
// (CreateAiExamBatchForm.tsx의 baseNameOf) 한글·공백 등을 그대로 담을 수 있는데, 지금까지는
// `filename="exam_${exam.code}.pdf"` 처럼 raw로 헤더에 넣고 있었다. HTTP 헤더 값은 순수 ASCII만
// 허용되고, Node의 fetch/undici 구현은 여기에 비ASCII 문자가 하나라도 있으면 Response 생성 시점에
// `TypeError: Invalid character in header content` 를 던진다 — 이 예외는 try/catch 밖에서 발생해
// 잡히지 않았고, 그 결과가 사용자가 본 원본 그대로의 "HTTP ERROR 500"(브라우저 기본 오류 페이지)였다.
//
// 고침: filename=(ASCII 전용 대체용)에는 항상 안전하게 걸러낸 문자열만 쓰고, 진짜 예쁜 파일명은
// filename*=UTF-8''(퍼센트 인코딩) 쪽에만 담는다(최신 브라우저는 filename*= 를 우선 사용한다).

/** ASCII가 아니거나 헤더/파일명에 위험한 문자를 전부 "_"로 바꾼다. 완전히 비면 fallback을 쓴다. */
function asciiSafe(s: string, fallback: string): string {
  const cleaned = s.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
  return cleaned || fallback;
}

/**
 * 다운로드 파일명을 위한 Content-Disposition 헤더 값을 만든다.
 * @param niceName 한글 등이 섞여도 되는 진짜 파일명(확장자 포함). filename*=에 퍼센트 인코딩되어 들어간다.
 * @param asciiFallback filename= 쪽에 쓸, 이미 ASCII임이 보장된 짧은 이름(확장자 포함).
 */
export function contentDispositionAttachment(niceName: string, asciiFallback: string): string {
  const safeAscii = asciiSafe(asciiFallback, "download");
  const encoded = encodeURIComponent(niceName);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}
