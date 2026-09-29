import PageLoading from "@/app/_components/PageLoading";

// 이 영역의 화면 사이를 옮길 때 위쪽 메뉴는 그대로 두고 본문 자리에 바로 "불러오는 중"을 보여 준다(2026-09-29 최적화).
export default function Loading() {
  return <PageLoading />;
}
