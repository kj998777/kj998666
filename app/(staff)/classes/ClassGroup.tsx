"use client";

import { useTransition } from "react";
import { removeClass } from "./actions";

export default function ClassGroup({
  level,
  grade,
  items,
  canEdit,
}: {
  level: string;
  grade: number;
  items: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-600 mb-2">
        {level}{grade} ({items.length}개)
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span key={it.id} className="badge bg-slate-100 text-slate-700 gap-2">
            {it.name}
            {canEdit && (
              <button
                className="text-slate-400 hover:text-red-600"
                disabled={pending}
                title="삭제"
                onClick={() => {
                  if (!confirm(`"${level}${grade} ${it.name}" 반을 삭제할까요?`)) return;
                  start(() => removeClass(it.id));
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
