// 휴대폰 사진은 3~8MB가 흔한데, Vercel 서버 함수는 요청 하나에 약 4.5MB까지만 받아서 그대로 올리면 실패한다.
// 브라우저에서 긴 변을 maxDim 픽셀로 줄이고 JPEG로 다시 저장해 보통 수백 KB로 만든다(글씨·수식은 충분히 읽힘).
// 줄이지 못하면(브라우저가 못 여는 형식 등) 원본을 그대로 돌려준다. 2026-09-29.
export async function compressImage(file: File, maxDim = 1800, quality = 0.85): Promise<File> {
  if (!file || !file.type.startsWith("image/")) return file;
  if (file.size < 600 * 1024 && /jpe?g|png|webp/.test(file.type)) return file; // 이미 작음
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("이미지를 열지 못했습니다."));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
