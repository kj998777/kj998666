// 문항 은행 "담은 문항" — 이 기기(브라우저)에 저장한다(직원 한 명이 시험지를 만드는 동안만 쓰는 목록이라 DB에 둘 필요가 없음).
// 학생 분석 화면의 "복습지 만들기"도 여기에 넣고 문항 은행으로 넘어간다.
const KEY = "mc-bank-cart";
const EVENT = "mc:bank-cart";
export const CART_MAX = 60;

export function readCart(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, CART_MAX) : [];
  } catch {
    return [];
  }
}

export function writeCart(ids: string[]): void {
  const uniq = Array.from(new Set(ids)).slice(0, CART_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(uniq));
  } catch {
    /* 저장이 막힌 브라우저면 이 화면에서만 */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: uniq }));
}

export function addToCart(ids: string[]): number {
  const cur = readCart();
  const next = [...cur, ...ids.filter((id) => !cur.includes(id))];
  writeCart(next);
  return Math.min(next.length, CART_MAX) - cur.length;
}

export function onCartChange(fn: (ids: string[]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string[]>).detail);
  const s = (e: StorageEvent) => {
    if (e.key === KEY) fn(readCart());
  };
  window.addEventListener(EVENT, h);
  window.addEventListener("storage", s);
  return () => {
    window.removeEventListener(EVENT, h);
    window.removeEventListener("storage", s);
  };
}
