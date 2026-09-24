import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// @ts-expect-error - @pdf-lib/fontkit has no bundled types in this project's TS setup
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { getExamPdfBuffer } from "./pdf";

// 시험지 PDF에 표지·정오표(정정 페이지)·QR 안내 쪽을 붙여 학생에게 나눠 줄 최종 PDF를 만든다.
// Apps Script(teacher-report-app.md v23~v25)의 stampPdf/coverCanvas/fixSheetCanvases 를
// pdf-lib(순수 JS, Vercel 서버리스에서 문제없이 동작)로 다시 구현한 것 — 원본은 브라우저에 서버가
// 없어 캔버스로 그림을 그려 이미지로 박아 넣는 방식이었지만, 여기서는 서버에 진짜 PDF 생성기가
// 있으므로 캔버스 없이 pdf-lib의 drawText/drawRectangle로 직접 그린다(더 가볍고 폰트도 선명함).
//
// 알아 둘 점(v1, 원본 대비 단순화한 부분):
// - 원본 해설·마킹(OMR) 쪽을 AI로 자동 판별해 빼는 기능(cleanPlan)은 아직 포팅하지 않았다.
//   대신 관리자가 뺄 쪽 번호를 직접 입력한다(excludePages).
// - 원본 페이지 안에 인쇄되어 있던 QR·안내 문구를 흰 칸으로 가리는 기능도 아직 없다.
// - 학원 로고 이미지 파일이 저장소에 없어 이번에는 글자(학원 이름)로 대신한다.
//   assets/branding/logo.png 를 넣어 두면 다음 버전에서 이미지로 바꿀 수 있다.

const ACADEMY_NAME = "메딕수학";
const ACADEMY_TEL = "064-702-3455";

type Client = any;

// 한글 폰트(Noto Sans KR, OFL 라이선스)를 저장소에 10MB짜리 바이너리로 커밋하는 대신
// Google Fonts 공식 GitHub 미러에서 요청 시 내려받아 함수 인스턴스가 살아 있는 동안 캐싱한다.
// 이 기능(관리자가 가끔 누르는 PDF 다운로드)은 빈도가 낮아 최초 1회의 다운로드 지연은 감수할 만하고,
// 대신 저장소 용량과 배포 크기를 10MB 아끼고 깃허브 웹 화면으로도 그대로 커밋할 수 있다.
const FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf";

let fontBytesCache: Buffer | null = null;
async function loadKoreanFontBytes(): Promise<Buffer> {
  if (fontBytesCache) return fontBytesCache;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error("한글 폰트를 내려받지 못했습니다 (" + res.status + "). 잠시 후 다시 시도해 주세요.");
  fontBytesCache = Buffer.from(await res.arrayBuffer());
  return fontBytesCache;
}

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

function wrapText(font: any, text: string, size: number, maxWidth: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/(\s+)/).filter((w) => w !== "");
    let line = "";
    for (const w of words) {
      const trial = line + w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = trial;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

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
  const koreanFontBytes = await loadKoreanFontBytes();
  out.registerFontkit(fontkit as any);
  const kfont = await out.embedFont(koreanFontBytes, { subset: true });
  const helv = await out.embedFont(StandardFonts.Helvetica);

  // 기준 페이지 크기 = 원본 첫 쪽 크기(표지·정오표·QR 쪽 모두 이 크기로 맞춘다)
  const firstSrc = src.getPage(keptIdx[0]);
  const { width: PW, height: PH } = firstSrc.getSize();

  // 1) 본문(원본에서 뺄 쪽 제외)
  const copied = await out.copyPages(src, keptIdx);
  // 2) 표지 + 백지 (이 시점에는 out이 비어 있으므로 순서대로 addPage 하면 그대로 맨 앞이 된다)
  if (opts.cover) {
    const cover = out.addPage([PW, PH]);
    drawCover(cover, kfont, helv, PW, PH, opts.examName);
    out.addPage([PW, PH]); // 백지
  }
  for (const p of copied) out.addPage(p);

  // 3) 정정 페이지(정오표) — 로고·QR 쪽 바로 앞
  const fixes = opts.fixes.filter((f) => f.issue || f.fix);
  if (opts.addFixPage && fixes.length) {
    drawFixPages(out, kfont, PW, PH, fixes);
  }

  // 4) 로고 + QR 쪽 (맨 뒤)
  const qrPng = await QRCode.toBuffer(opts.submitUrl, { type: "png", width: 600, margin: 1 });
  const qrImage = await out.embedPng(qrPng);
  const back = out.addPage([PW, PH]);
  drawBackPage(back, kfont, helv, PW, PH, qrImage, opts.examCode);

  // 총 쪽수는 항상 짝수로 맞춘다(양면 인쇄 대비, 원본 방식과 동일)
  if (out.getPageCount() % 2 !== 0) out.addPage([PW, PH]);

  return out.save();
}

function drawCover(page: any, kfont: any, helv: any, PW: number, PH: number, examName: string): void {
  const cx = PW / 2;
  let y = PH - 90;
  const title = examName || "시험지";
  const titleSize = title.length > 20 ? 20 : 26;
  const tw = kfont.widthOfTextAtSize(title, titleSize);
  page.drawText(title, { x: cx - tw / 2, y, size: titleSize, font: kfont, color: rgb(0.15, 0.15, 0.2) });
  y -= 50;

  const big = "내신 기출 문제지";
  const bw = kfont.widthOfTextAtSize(big, 34);
  page.drawText(big, { x: cx - bw / 2, y, size: 34, font: kfont, color: rgb(0.05, 0.05, 0.1) });
  y -= 34;
  const badge = "내신 대비";
  const bdw = kfont.widthOfTextAtSize(badge, 14);
  page.drawRectangle({ x: cx - bdw / 2 - 10, y: y - 22, width: bdw + 20, height: 28, color: rgb(0.9, 0.95, 1) });
  page.drawText(badge, { x: cx - bdw / 2, y: y - 16, size: 14, font: kfont, color: rgb(0.1, 0.3, 0.6) });
  y -= 70;

  // 이름/반 기입 칸
  page.drawText("반: __________    이름: __________", { x: cx - 140, y, size: 15, font: kfont, color: rgb(0.2, 0.2, 0.2) });
  y -= 40;

  // 안내 상자
  const boxW = PW - 140;
  const boxX = 70;
  const boxLines = [
    "· 위 칸에 반과 이름을 적어 주세요.",
    "· 마지막 쪽의 QR 코드를 스캔하면 답을 제출할 수 있습니다.",
    "· 제출하면 자동으로 채점되고, 문항별 분석 보고서를 받아볼 수 있습니다.",
    "· 궁금한 점이 있으면 아래 연락처로 상담해 주세요.",
  ];
  const boxH = 26 + boxLines.length * 22 + 40;
  page.drawRectangle({ x: boxX, y: y - boxH, width: boxW, height: boxH, borderColor: rgb(0.7, 0.7, 0.75), borderWidth: 1 });
  let by = y - 30;
  for (const line of boxLines) {
    page.drawText(line, { x: boxX + 20, y: by, size: 13, font: kfont, color: rgb(0.25, 0.25, 0.3) });
    by -= 22;
  }
  by -= 10;
  const telText = `문의·상담 : ${ACADEMY_TEL}`;
  const telW = kfont.widthOfTextAtSize(telText, 13);
  page.drawRectangle({ x: cx - telW / 2 - 12, y: by - 8, width: telW + 24, height: 26, color: rgb(0.93, 0.93, 0.93) });
  page.drawText(telText, { x: cx - telW / 2, y: by, size: 13, font: kfont, color: rgb(0.2, 0.2, 0.2) });
  y -= boxH + 40;

  // 목록 상자
  const listItems = ["내신 기출 분석", "문항별 해설", "성적 분석 보고서"];
  const listW = 260;
  const listH = 26 + listItems.length * 22;
  page.drawRectangle({ x: cx - listW / 2, y: y - listH, width: listW, height: listH, borderColor: rgb(0.75, 0.75, 0.8), borderWidth: 1 });
  let ly = y - 26;
  for (const item of listItems) {
    page.drawText("· " + item, { x: cx - listW / 2 + 20, y: ly, size: 12, font: kfont, color: rgb(0.3, 0.3, 0.35) });
    ly -= 22;
  }

  // 맨 아래 학원 이름
  const nameText = ACADEMY_NAME;
  const nameSize = 26;
  const nameW = kfont.widthOfTextAtSize(nameText, nameSize);
  page.drawText(nameText, { x: cx - nameW / 2, y: 70, size: nameSize, font: kfont, color: rgb(0.1, 0.1, 0.15) });
  void helv;
}

function drawFixPages(out: PDFDocument, kfont: any, PW: number, PH: number, fixes: Correction[]): void {
  const mx = 60;
  const contentW = PW - mx * 2;
  let page: any;
  let first = true;
  let y = 0;

  function fresh() {
    page = out.addPage([PW, PH]);
    y = PH - 90;
    page.drawText(first ? "정오표 (시험지 정정 안내)" : "정오표 (이어서)", { x: mx, y, size: 22, font: kfont, color: rgb(0.05, 0.05, 0.1) });
    y -= 22;
    if (first) {
      page.drawText("아래 문항은 시험지 인쇄에 오류가 있어 이렇게 고쳐서 풀어 주세요.", {
        x: mx,
        y,
        size: 12,
        font: kfont,
        color: rgb(0.3, 0.3, 0.35),
      });
      y -= 18;
    }
    page.drawLine({ start: { x: mx, y }, end: { x: PW - mx, y }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
    y -= 26;
    first = false;
  }

  fresh();

  for (const f of fixes) {
    const label = /^\d/.test(f.label) ? f.label + "번" : f.label;
    const text = (f.issue ? `[오류] ${f.issue}\n` : "") + (f.fix ? `[정정] ${f.fix}` : "");
    const lines = wrapText(kfont, text, 12, contentW - 110);
    const need = lines.length * 18 + 24;
    if (y - need < 70) fresh();
    page.drawText(label, { x: mx, y: y - 4, size: 13, font: kfont, color: rgb(0.05, 0.05, 0.1) });
    let ty = y - 4;
    for (const line of lines) {
      page.drawText(line, { x: mx + 100, y: ty, size: 12, font: kfont, color: rgb(0.15, 0.15, 0.2) });
      ty -= 18;
    }
    y = ty - 12;
    page.drawLine({ start: { x: mx, y: y + 6 }, end: { x: PW - mx, y: y + 6 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  }
}

function drawBackPage(page: any, kfont: any, helv: any, PW: number, PH: number, qrImage: any, examCode: string): void {
  const cx = PW / 2;
  const nameText = ACADEMY_NAME;
  const nameSize = 30;
  const nameW = kfont.widthOfTextAtSize(nameText, nameSize);
  page.drawText(nameText, { x: cx - nameW / 2, y: PH / 2 + 20, size: nameSize, font: kfont, color: rgb(0.15, 0.15, 0.2) });

  const qrSize = Math.min(220, PW * 0.32);
  const qrX = PW - 70 - qrSize;
  const qrY = 60;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  const caption = "QR을 스캔해 답 제출";
  const capW = kfont.widthOfTextAtSize(caption, 12);
  page.drawText(caption, { x: qrX + qrSize / 2 - capW / 2, y: qrY - 18, size: 12, font: kfont, color: rgb(0.3, 0.3, 0.35) });
  void helv;
  void examCode;
}

