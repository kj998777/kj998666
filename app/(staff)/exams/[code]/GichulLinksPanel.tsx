"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { displayNo, choiceOfLabel, CHOICES } from "@/lib/exams/mockCsat";
import { GICHUL_IMAGE_MAX, type GichulLink, type GichulMap } from "@/lib/exams/gichulLinks";
import { addGichulLink, deleteGichulLink, importGichulLinks, updateGichulLink } from "../mock-actions";

// 고3 사설 모의고사 기출 아이디어 연결(0057) — 2026-10-12 원장님 "어떤 기출에서 나온 아이디어인지, 4점 문항만, 사이트에 등록".
// 문항마다 같은 아이디어의 평가원 기출(출처·공통 아이디어·기출 문제 그림)을 보고·고치고·더한다.
// 보고서: 문항별 표에 출처, 틀린·빈 문항에는 기출 그림까지 실린다(buildReportPdf.ts).

function partName(label: string): string {
  const c = choiceOfLabel(label);
  return c ? CHOICES.find((x) => x.key === c)?.name ?? "" : "공통";
}

/** 고른 그림을 가로 700px 이하로 줄여 data URL로(PNG, 너무 크면 JPEG) */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("그림을 열지 못했습니다."));
      i.src = url;
    });
    const scale = Math.min(1, 700 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/png");
    if (out.length > GICHUL_IMAGE_MAX) out = c.toDataURL("image/jpeg", 0.85);
    if (out.length > GICHUL_IMAGE_MAX) out = c.toDataURL("image/jpeg", 0.6);
    if (out.length > GICHUL_IMAGE_MAX) throw new Error("그림이 너무 큽니다. 문제 부분만 잘라서 올려 주세요.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LinkRow({ code, link }: { code: string; link: GichulLink }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [big, setBig] = useState(false);
  const [source, setSource] = useState(link.source);
  const [idea, setIdea] = useState(link.idea);
  const [rank, setRank] = useState(String(link.rank));
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="border border-slate-200 rounded p-3 space-y-2 bg-white">
      {edit ? (
        <div className="space-y-2">
          <div className="grid grid-cols-[4rem_1fr] gap-2 items-center">
            <label className="text-xs text-slate-500" htmlFor={`gs-${link.id}`}>
              출처
            </label>
            <input id={`gs-${link.id}`} className="input" value={source} onChange={(e) => setSource(e.target.value)} />
            <label className="text-xs text-slate-500" htmlFor={`gi-${link.id}`}>
              공통 아이디어
            </label>
            <input id={`gi-${link.id}`} className="input" value={idea} onChange={(e) => setIdea(e.target.value)} />
            <label className="text-xs text-slate-500" htmlFor={`gr-${link.id}`}>
              순서
            </label>
            <input id={`gr-${link.id}`} className="input w-20" type="number" min={1} max={9} value={rank} onChange={(e) => setRank(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await updateGichulLink(code, link.id!, { source, idea, rank: Number(rank) });
                  if (!r.ok) return setMsg(r.msg);
                  setEdit(false);
                  setMsg("");
                  router.refresh();
                })
              }
            >
              저장
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEdit(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm">
              {link.rank > 1 && <span className="text-xs text-slate-400 mr-1">후보 {link.rank}</span>}
              {link.source}
            </p>
            {link.idea && <p className="text-sm text-emerald-800">{link.idea}</p>}
          </div>
          <div className="flex gap-1 shrink-0">
            <button type="button" className="btn-secondary text-xs" onClick={() => setEdit(true)}>
              고치기
            </button>
            {sure ? (
              <button
                type="button"
                className="btn-danger text-xs"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteGichulLink(code, link.id!);
                    if (!r.ok) return setMsg(r.msg);
                    router.refresh();
                  })
                }
              >
                정말 지우기
              </button>
            ) : (
              <button type="button" className="btn-secondary text-xs" onClick={() => setSure(true)}>
                지우기
              </button>
            )}
          </div>
        </div>
      )}
      {link.image && (
        <button type="button" className="block w-full text-left" onClick={() => setBig((v) => !v)} title={big ? "작게 보기" : "크게 보기"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.image} alt={`${link.source} 문제`} className={"border border-slate-100 rounded " + (big ? "w-full max-w-2xl" : "max-h-40")} />
        </button>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}

export default function GichulLinksPanel({
  code,
  labels,
  links,
  isAdmin,
}: {
  code: string;
  /** 정답표 문항(순서대로) — 추가할 때 고르는 목록 */
  labels: string[];
  links: GichulMap;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [idea, setIdea] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [replace, setReplace] = useState(false);

  const linked = labels.filter((l) => links[l]?.length);
  const extra = Object.keys(links).filter((l) => !labels.includes(l)); // 정답표에 없는 번호(예전 연결)
  const total = (Object.values(links) as GichulLink[][]).reduce((a, x) => a + x.length, 0);

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-medium">기출 아이디어 연결</h2>
        <p className="text-sm text-slate-500 mt-1">
          문항마다 같은 아이디어를 쓴 평가원 기출입니다. 학생 개별 보고서의 문항별 표에 출처가 실리고, 틀리거나 비운 문항에는 기출 문제 그림까지 붙습니다.
          {total > 0 ? ` 지금 ${linked.length + extra.length}문항에 기출 ${total}개가 연결되어 있습니다.` : " 아직 연결된 기출이 없습니다."}
        </p>
      </div>

      {[...linked, ...extra].map((l) => (
        <div key={l} className="grid grid-cols-1 sm:grid-cols-[5rem_minmax(0,1fr)] gap-2">
          <div className="sm:text-center">
            <div className="text-xs text-slate-500">{partName(l)}</div>
            <div className="text-2xl font-semibold text-rose-700 leading-none">{displayNo(l)}</div>
          </div>
          <div className="space-y-2 min-w-0">
            {links[l].map((k) => (
              <LinkRow key={k.id} code={code} link={k} />
            ))}
          </div>
        </div>
      ))}

      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">기출 연결 추가</summary>
        <form
          className="grid gap-2 mt-3 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const r = await addGichulLink(code, { label, source, idea, image, rank: (links[label]?.length ?? 0) + 1 });
              if (!r.ok) return setMsg({ ok: false, text: r.msg });
              setSource("");
              setIdea("");
              setImage(null);
              setMsg({ ok: true, text: "추가했습니다." });
              router.refresh();
            });
          }}
        >
          <label className="label" htmlFor="gichul-label">
            문항
          </label>
          <select id="gichul-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} required>
            <option value="">고르세요</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {partName(l)} {displayNo(l)}번
              </option>
            ))}
          </select>
          <label className="label" htmlFor="gichul-source">
            기출 출처
          </label>
          <input
            id="gichul-source"
            className="input"
            placeholder="예: 2026학년도 수능 공통 21번"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          />
          <label className="label" htmlFor="gichul-idea">
            공통 아이디어 한 줄
          </label>
          <input
            id="gichul-idea"
            className="input"
            placeholder="예: 분모가 0이 되는 점에서 분자도 0 → 극한 존재 조건으로 함수 결정"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
          />
          <label className="label" htmlFor="gichul-image">
            기출 문제 그림 (캡처한 그림, 선택)
          </label>
          <input
            id="gichul-image"
            type="file"
            accept="image/*"
            className="text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return setImage(null);
              try {
                setImage(await shrinkImage(f));
              } catch (err: any) {
                setImage(null);
                setMsg({ ok: false, text: String(err?.message ?? err) });
              }
            }}
          />
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="고른 그림" className="max-h-40 border rounded" />
          )}
          <div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "저장하는 중…" : "추가"}
            </button>
          </div>
        </form>
      </details>

      {isAdmin && (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">JSON 파일로 한꺼번에 넣기 (관리자)</summary>
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-slate-500">
              형식: [{"{"}&quot;label&quot;: &quot;15&quot;, &quot;source&quot;: &quot;…&quot;, &quot;idea&quot;: &quot;…&quot;, &quot;image&quot;: &quot;data:image/png;base64,…&quot;{"}"}, …]. 같은
              문항·같은 출처가 이미 있으면 건너뜁니다.
            </p>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" id="gichul-replace" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              이 시험의 기존 연결을 모두 지우고 넣기
            </label>
            <input
              id="gichul-json"
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setMsg(null);
                const text = await f.text();
                start(async () => {
                  const r = await importGichulLinks(code, text, replace);
                  e.target.value = "";
                  if (!r.ok) return setMsg({ ok: false, text: r.msg });
                  setMsg({ ok: true, text: `${r.added}개를 넣었습니다${r.skipped ? ` (건너뜀 ${r.skipped}개)` : ""}.` });
                  router.refresh();
                });
              }}
            />
          </div>
        </details>
      )}

      {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
