// 화면을 옮길 때 새 화면이 준비되는 동안 바로 보여 주는 자리 표시(2026-09-29 최적화).
// 전에는 불러오는 동안 이전 화면이 멈춘 듯 그대로 있다가 한 번에 바뀌어 "버벅인다"는 느낌이 컸다.
// 서버 컴포넌트라 자바스크립트를 더하지 않는다.
export default function PageLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        불러오는 중…
      </div>
      <div className="space-y-2 animate-pulse">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="h-4 w-72 max-w-full rounded bg-slate-100" />
      </div>
      <div className="card space-y-3 animate-pulse">
        <div className="h-4 w-1/3 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-5/6 rounded bg-slate-100" />
        <div className="h-4 w-2/3 rounded bg-slate-100" />
      </div>
      <div className="card space-y-3 animate-pulse">
        <div className="h-4 w-1/4 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-3/4 rounded bg-slate-100" />
      </div>
    </div>
  );
}
