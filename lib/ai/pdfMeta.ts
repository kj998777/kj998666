import "server-only";
import { PDFDocument } from "pdf-lib";

// 업로드된 시험지 PDF의 쪽수를 서버에서 직접 판별한다(exam_pdf_meta.pages).
//
// 스캔본 여부(is_scanned)는 exam_pdf_meta 컬럼 주석에 "브라우저의 pdf.js가 업로드 시 판별"이라고
// 적어 두었던 항목이다. pdf-lib의 저수준(문서화되지 않은) 콘텐츠 스트림 API로 직접 판별하는 방법도
// 검토했지만, 이 프로젝트는 로컬에서 실제 빌드로 검증할 수 없는 환경(레지스트리 접근 제한)이라
// 버전별로 달라질 수 있는 내부 API에 기대는 코드를 넣는 위험을 피했다(예전에 @pdf-lib/fontkit
// 타입 가정이 틀려 실제 Vercel 빌드를 깬 적이 있음 — project doc 참고). 그래서 is_scanned는 여전히
// null(판단 보류)로 두고, 필요하면 관리자가 시험지를 보고 수동으로 판단해 디지털화를 시작한다
// (lib/ai/digitize.ts는 이 값에 의존하지 않고 항상 실제 페이지 수를 직접 다시 센다).

export async function countPdfPages(pdf: Buffer): Promise<number | null> {
    try {
          const doc = await PDFDocument.load(pdf);
          return doc.getPageCount();
    } catch {
          return null;
    }
}
