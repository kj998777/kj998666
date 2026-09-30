// 문항 은행 "담은 문항" — 이 기기(브라우저)에 저장한다(직원 한 명이 시험지를 만드는 동안만 쓰는 목록이라 DB에 둘 필요가 없음).
// 학생 분석 화면의 "복습지 만들기"도 여기에 넣고 문항 은행으로 넘어간다.
// 2026-09-30: 과외선생님 맞춤 시험지도 같은 방식(다른 이름·최대 30개)으로 쓰려고 makeCart로 나눴다.

export type Cart = {
  max: number;
  read: () => string[];
  write: (ids: string[]) => void;
  add: (ids: string[]) => number;
  onChange: (fn: (ids: string[]) => void) => () => void;
};

export function makeCart(key: string, max: number): Cart {
  const event = `mc:cart:${key}`;
  const read = (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max) : [];
    } catch {
      return [];
    }
  };
  const write = (ids: string[]): void => {
    const uniq = Array.from(new Set(ids)).slice(0, max);
    try {
      localStorage.setItem(key, JSON.stringify(uniq));
    } catch {
      /* 저장이 막힌 브라우저면 이 화면에서만 */
    }
    window.dispatchEvent(new CustomEvent(event, { detail: uniq }));
  };
  const add = (ids: string[]): number => {
    const cur = read();
    const next = [...cur, ...ids.filter((id) => !cur.includes(id))];
    write(next);
    return Math.min(next.length, max) - cur.length;
  };
  const onChange = (fn: (ids: string[]) => void): (() => void) => {
    const h = (e: Event) => fn((e as CustomEvent<string[]>).detail);
    const s = (e: StorageEvent) => {
      if (e.key === key) fn(read());
    };
    window.addEventListener(event, h);
    window.addEventListener("storage", s);
    return () => {
      window.removeEventListener(event, h);
      window.removeEventListener("storage", s);
    };
  };
  return { max, read, write, add, onChange };
}

const staff = makeCart("mc-bank-cart", 60);
export const CART_MAX = staff.max;
export const readCart = staff.read;
export const writeCart = staff.write;
export const addToCart = staff.add;
export const onCartChange = staff.onChange;

/** 과외선생님 맞춤 시험지(최대 30문항 — tutor_create_worksheet와 같은 값) */
export const tutorCart = makeCart("mc-tutor-ws-cart", 30);
