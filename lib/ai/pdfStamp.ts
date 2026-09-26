import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { getExamPdfBuffer } from "./pdf";
import { renderCoverPng, renderFixSheetPngs, renderStampPng } from "./canvasStamp";

// 시험지 PDF에 표지·정오표(정정 페이지)·QR 안내 쪽을 붙여 학생에게 나눠 줄 최종 PDF를 만든다.
//
// 2026-09-26: 기존 Apps Script(teacher-report-app.md v23~v25)의 stampPdf를 "그림(PNG)을 그려서
// 박아 넣는" 원래 방식 그대로 다시 포팅했다. (직전 버전(v1)은 pdf-lib의 drawText로 직접 글자를
// 그리는 방식으로 재구현했었는데, 그러려면 한글 폰트를 PDF 안에 임베드·서브셋해야 했고, 그게
// 2026-09에 있었던 두 차례 폰트 버그(① 가변 폰트의 gvar 보간 정보를 pdf-lib/fontkit이 처리하지
// 못해 글자가 깨짐 ② 그 다음 정적 폰트로 바꾸니 CID-keyed CFF 구조를 서브셋하지 못해 "Not a CFF
// Font" 오류)의 근본 원인이었다. 이번에 원본과 똑같이 "캔버스로 그려서 이미지로 박아 넣는" 방식
// 으로 되돌리면서, 서버에는 브라우저 캔버스가 없으므로 @napi-rs/canvas(Skia 기반 Node용 캔버스,
// lib/ai/canvasStamp.ts)로 대신 그린다. 표지·정오표·QR 안내 쪽의 글자가 전부 그림이 되므로 PDF에
// 폰트를 임베드할 필요가 아예 없어져, 이 버그가 구조적으로 다시 생길 수 없다.
// 학원 로고도 이제 실제 이미지(assets/branding/logo.png — teacher-report-app.md의 LOGO_B64를
// 그대로 추출)를 쓴다. v1에서는 로고 파일이 없어 글자(학원명)로 대신했었다.
//
// 여전히 남은, 원본 대비 단순화한 부분: 원본 해설·마킹(OMR) 쪽 자동 판별(cleanPlan)은 아직
// 포팅하지 않아 관리자가 뺄 쪽 번호를 직접 입력한다(excludePages). 원본 페이지 안의 QR·안내
// 문구를 흰 칸으로 가리는 기능도 없음.

const LOGO_PATH = path.join(process.cwd(), "assets", "branding", "logo.png");

type Client = any;

export type Correction = { label: string; issue: string; fix: string };

export type StampOptions = {
  cover: boolean;
  addFixPage: boolean;
  excludePages: number[]; // 1-indexed, 원본에서 뺄 쪽(해설·마킹 등)
  examName: string;
  examCode: string;
  submitUrl: string;
  fixes: Correction[];
};

/** 원본 PDF(examId 로 저장된)에 표지·정정 페이지·QR 쪽을 붙인 최종 PDF 바이트를 만든다. */
export async function buildStampedExamPdf(client: Client, examId: string, opts: StampOptions): Promise<Uint8Array> {
  const srcBytes = await getExamPdfBuffer(client, examId);
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalSrcPages = src.getPageCount();
  if (!totalSrcPages) throw new Error("쪽이 없는 PDF입니다.");

  const keep = new Set(Array.from({ length: totalSrcPages }, (_, i) => i + 1));
  for (const p of opts.excludePages) keep.delete(p);
  const keptIdx = Array.from(keep).sort((a, b) => a - b).map((n) => n - 1);
  if (!keptIdx.length) throw new Error("모든 쪽을 뺄 수는 없습니다.");

  const out = await PDFDocument.create();

  // 기준 페이지 크기 = 원본 첫 쪽 크기(표지·정오표·QR 쪽 모두 이 크기로 맞춘다)
  const firstSrc = src.getPage(keptIdx[0]);
  const { width: PW, height: PH } = firstSrc.getSize();

  // 1) 본문(원본에서 뺄 쪽 제외)
  const copied = await out.copyPages(src, keptIdx);

  // 2) 표지 + 백지 — 그림(PNG) 한 장을 쪽 전체에 꽉 채워 그린다(이 시점에는 out이 비어 있으므로
  //    순서대로 addPage 하면 그대로 맨 앞이 된다)
  if (opts.cover) {
    const coverPng = await renderCoverPng(opts.examName, PW, PH);
    const coverImg = await out.embedPng(coverPng);
    const coverPage = out.addPage([PW, PH]);
    coverPage.drawImage(coverImg, { x: 0, y: 0, width: PW, height: PH });
    out.addPage([PW, PH]); // 백지(앞뒤 인쇄 때 표지 뒷면이 비도록)
  }
  for (const p of copied) out.addPage(p);

  // 3) 정정 페이지(정오표) — 로고·QR 쪽 바로 앞. 원본 시험지 쪽은 건드리지 않는다
  const fixes = opts.fixes.filter((f) => f.issue || f.fix);
  if (opts.addFixPage && fixes.length) {
    const sheetPngs = await renderFixSheetPngs(fixes, PW, PH);
    for (const png of sheetPngs) {
      const img = await out.embedPng(png);
      const page = out.addPage([PW, PH]);
      page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
    }
  }

  // 4) 로고 + QR 쪽(맨 뒤): 가운데 = 학원 로고(폭의 70%), 오른쪽 아래 = 이 시험의 답안 제출 QR
  //    박스(폭의 30%, 여백 12mm) — 원본 stampPdf의 배치 그대로.
  const [logoBytes, stampPng] = await Promise.all([
    readFile(LOGO_PATH),
    renderStampPng(opts.examCode, opts.submitUrl),
  ]);
  const logoImg = await out.embedPng(logoBytes);
  const stampImg = await out.embedPng(stampPng);
  const back = out.addPage([PW, PH]);
  const lw = PW * 0.7,
    lh = (lw * logoImg.height) / logoImg.width;
  back.drawImage(logoImg, { x: (PW - lw) / 2, y: (PH - lh) / 2, width: lw, height: lh });
  const pt = 72 / 25.4; // mm -> pt
  const W = PW * 0.3,
    H = (W * stampImg.height) / stampImg.width,
    mg = 12 * pt;
  back.drawImage(stampImg, { x: PW - W - mg, y: mg, width: W, height: H });

  // 총 쪽수는 항상 짝수로 맞춘다(양면 인쇄 대비, 원본 방식과 동일)
  if (out.getPageCount() % 2 !== 0) out.addPage([PW, PH]);

  return out.save();
}
