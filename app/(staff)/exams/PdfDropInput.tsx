"use client";

import { useEffect, useRef, useState } from "react";

// 시험지 PDF 파일 칸(2026-09-29 원장님 요청: 드래그 앤 드롭으로도 올리기).
// 진짜 <input type="file">을 투명하게 영역 전체에 덮어 두어 누르면 파일 고르기 창이 열리고, 끌어다 놓은 파일은
// 여기서 받아(drop) 그 입력 칸에 넣어 준다. 그래서 기존 폼들(FormData로 name="pdf"를 읽음)은 고칠 필요가 없다.
// 놓은 파일 중 PDF가 아닌 것은 빼고, 하나만 받는 칸에 여러 개를 놓으면 첫 파일만 남긴다.
// 영역 밖에 잘못 놓아도 브라우저가 PDF를 열어 화면을 떠나 버리지 않도록 화면 전체의 "놓기"를 막아 둔다.

function isPdf(f: File) {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function fmtSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export default function PdfDropInput({
  name,
  multiple = false,
  required = false,
  disabled = false,
  onFiles,
  compact = false,
}: {
  name?: string;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** 파일이 정해질 때마다(고르기·놓기) 걸러진 목록을 알려 준다 */
  onFiles?: (files: File[]) => void;
  /** 한 줄짜리 좁은 영역(시험 상세 화면용) */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [chosen, setChosen] = useState<{ name: string; size: number }[]>([]);
  const [note, setNote] = useState("");

  // 폼이 reset되면(업로드 성공 후 등) 표시도 비운다
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setChosen([]);
      setNote("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  // 영역 밖에 떨어뜨린 파일을 브라우저가 열어 버리지 않게
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  function handle(list: File[], forceAssign = false) {
    const input = inputRef.current;
    const pdfs = list.filter(isPdf);
    const skipped = list.length - pdfs.length;
    const keep = multiple ? pdfs : pdfs.slice(0, 1);
    const notes: string[] = [];
    if (skipped) notes.push(`PDF가 아닌 파일 ${skipped}개는 뺐습니다.`);
    if (!multiple && pdfs.length > 1) notes.push("한 번에 하나만 올릴 수 있어 첫 파일만 골랐습니다.");
    setNote(notes.join(" "));
    // 걸러낸 결과를 실제 입력 칸에도 반영(폼 제출 때 FormData가 이 값을 읽음)
    if (input && (forceAssign || keep.length !== list.length)) {
      try {
        const dt = new DataTransfer();
        keep.forEach((f) => dt.items.add(f));
        input.files = dt.files;
      } catch {
        /* 아주 오래된 브라우저 — 그대로 둔다 */
      }
    }
    setChosen(keep.map((f) => ({ name: f.name, size: f.size })));
    onFiles?.(keep);
  }

  return (
    <div>
      <div
        className={
          "relative rounded-lg border-2 border-dashed text-center transition-colors " +
          (compact ? "px-3 py-3 " : "px-4 py-6 ") +
          (disabled
            ? "border-slate-200 bg-slate-50 opacity-60"
            : over
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 bg-white hover:border-slate-400")
        }
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault(); // 놓기 허용
          if (!disabled) setOver(true);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length) handle(files, true);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept="application/pdf,.pdf"
          multiple={multiple}
          required={required}
          disabled={disabled}
          aria-label={multiple ? "시험지 PDF 여러 개 고르기 또는 끌어다 놓기" : "시험지 PDF 고르기 또는 끌어다 놓기"}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={(e) => handle(Array.from(e.target.files ?? []))}
        />
        <div className="pointer-events-none space-y-1">
          {chosen.length === 0 ? (
            <>
              <p className={"font-medium text-slate-700 " + (compact ? "text-sm" : "")}>
                {over ? "여기에 놓으세요" : multiple ? "PDF 파일들을 여기로 끌어다 놓거나 눌러서 고르세요" : "PDF 파일을 여기로 끌어다 놓거나 눌러서 고르세요"}
              </p>
              {!compact && <p className="text-xs text-slate-500">파일당 최대 20MB</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-800">
                {chosen.length === 1 ? chosen[0].name : `PDF ${chosen.length}개 선택됨`}
                {chosen.length === 1 && <span className="font-normal text-slate-500"> · {fmtSize(chosen[0].size)}</span>}
              </p>
              <p className="text-xs text-slate-500">다른 파일로 바꾸려면 다시 끌어다 놓거나 누르세요</p>
            </>
          )}
        </div>
      </div>
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
