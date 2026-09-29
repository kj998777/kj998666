import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";

// 과외선생님 사용법(2026-09-28 원장님 요청: "처음 쓰는 사람도 쓸 수 있게, 이미지와 화살표로 설명").
// 이미지는 public/guide/*.webp — 실제 화면과 같은 모양의 예시 화면(가짜 데이터)에 빨간 테두리·화살표·
// 번호를 그려 넣은 것. 아래 각 단계의 번호 목록이 그림 속 번호와 1:1로 대응한다.
// 화면 문구가 바뀌면 그림도 같이 다시 만들어야 한다.
// 2026-09-29 갱신: 맡은 문제 탭(11-assigned), 적던 답 임시 저장, 사진 자동 줄이기, 전체 문제 해설지 PDF, 문항 자동 자르기,
// 환영 포인트·배정 일시 정지 FAQ. 모든 그림의 위쪽 메뉴에 "맡은 문제"가 들어가도록 다시 찍었다.
// 2026-09-29 4차: 풀이 사진 "사진 찍기 / 앨범에서 고르기" 두 버튼(04-answer 그림·설명).
// 2026-09-29 3차: 배정 시간 30분 → 1시간(0027)에 맞춰 문구·그림(11-assigned) 수정.
// 2026-09-29 2차: 원장님 요청으로 단계별 탭(?tab=start|review|store|manage|bugs|faq)으로 나눠 한 단계씩 보여 준다
// (서버에서 탭을 골라 그리므로 자바스크립트 없이도 동작, 링크로 특정 단계를 바로 열 수 있음). "버그 신고" 단계(12-bugs) 추가.

type Shot = { src: string; w: number; h: number; alt: string };
type Step = {
  id: string;
  title: string;
  lead: string;
  shot: Shot;
  points: React.ReactNode[];
  tip?: React.ReactNode;
};

const SECTIONS: { id: string; title: string; summary: string; steps: Step[] }[] = [
  {
    id: "start",
    title: "시작하기",
    summary: "로그인하면 가장 먼저 보이는 “내 활동” 화면입니다.",
    steps: [
      {
        id: "dashboard",
        title: "내 활동 화면 둘러보기",
        lead: "위쪽 메뉴에서 언제든 원하는 곳으로 이동할 수 있습니다. 맨 오른쪽 “버그 신고”는 화면이 이상할 때 알려 주는 곳입니다(아래 “버그 신고” 탭 참고).",
        shot: { src: "/guide/01-dashboard.webp", w: 1180, h: 578, alt: "내 활동 화면 — 검토하기, 맡은 문제, 기출 스토어, 포인트, 검토하러 가기 버튼 위치" },
        points: [
          <><b>검토하기</b> — 문항을 풀어서 포인트를 버는 곳입니다.</>,
          <><b>맡은 문제</b> — 지금 배정받아 풀고 있는 문항이 모여 있습니다. 옆의 빨간 숫자가 풀고 있는 문항 수입니다.</>,
          <><b>기출 스토어</b> — 모은 포인트로 기출문제 PDF를 사는 곳입니다.</>,
          <><b>포인트</b> — 지금 가진 포인트입니다. 어느 화면에서든 오른쪽 위에 항상 보입니다.</>,
          <>처음이라면 <b>검토하러 가기</b>를 눌러 포인트부터 모아 보세요.</>,
        ],
      },
    ],
  },
  {
    id: "review",
    title: "1단계 · 문항 검토하고 포인트 받기",
    summary: "AI가 푼 정답·풀이 중 확인이 필요한 문항을 직접 풀어 주면 1문항당 1포인트가 바로 들어옵니다.",
    steps: [
      {
        id: "review-start",
        title: "문항 받기",
        lead: "검토하기 화면에서 버튼 하나만 누르면 됩니다. 어떤 문항이 나올지는 자동으로 정해집니다.",
        shot: { src: "/guide/02-review-start.webp", w: 1180, h: 282, alt: "검토하기 화면 — 다음 문항 받기 버튼" },
        points: [<><b>다음 문항 받기</b>를 누르면 문항 하나가 선생님께 배정됩니다.</>],
        tip: <>받은 문항은 <b>1시간 동안</b> 선생님만 풀 수 있도록 잡아 둡니다. 1시간이 지나면 다른 분께 넘어갈 수 있으니 받은 뒤 바로 풀어 주세요. 이미 풀고 있는 문항이 있으면 이 화면 위에 <b>&ldquo;풀고 있던 문제가 있습니다&rdquo;</b>가 먼저 나오고, 버튼을 눌러도 새 문항 대신 그 문항이 다시 열립니다.</>,
      },
      {
        id: "review-assigned",
        title: "다른 앱에 다녀왔다면 — 맡은 문제에서 이어서 풀기",
        lead: "휴대폰에서 카톡·카메라 등 다른 앱에 갔다 오면 화면이 처음으로 돌아갈 수 있습니다. 문항은 그대로 선생님 몫이니 위쪽 메뉴의 “맡은 문제”로 가세요.",
        shot: { src: "/guide/11-assigned.webp", w: 1180, h: 360, alt: "맡은 문제 화면 — 시험·문항 번호와 남은 시간, 이어서 풀기, 포기 버튼" },
        points: [
          <>지금 맡고 있는 문항과 <b>남은 시간</b>입니다. 5분 이하로 남으면 빨간색으로 바뀝니다.</>,
          <><b>이어서 풀기</b> — 그 문항 화면이 다시 열립니다. 적던 답·풀이도 그대로 불러옵니다(아래 참고).</>,
          <><b>포기</b> — 이 문항을 내려놓습니다. 한 번 더 확인한 뒤 &ldquo;정말 포기&rdquo;를 눌러야 풀립니다.</>,
        ],
      },
      {
        id: "review-problem",
        title: "문제 확인하기",
        lead: "원본 시험지에서 그 문항 부분만 잘라 크게 보여 줍니다.",
        shot: { src: "/guide/03-problem.webp", w: 1180, h: 468, alt: "문항 화면 — 문제 이미지, 전체 쪽 보기, 이전 쪽/다음 쪽 버튼" },
        points: [
          <>원본 시험지에서 잘라 낸 <b>문제 이미지</b>입니다. 시험지에서 문항 번호 자리를 찾아 그 문항만 자동으로 잘라 내며, 그림·표·보기도 그대로 보입니다.</>,
          <>문제가 잘려 보이거나 엉뚱한 부분이 나오면 <b>전체 쪽 보기</b>로 시험지 한 쪽을 통째로 보세요.</>,
          <>문제가 다른 쪽에 이어지면 <b>← 이전 쪽 / 다음 쪽 →</b>으로 넘겨 가며 찾을 수 있습니다.</>,
        ],
      },
      {
        id: "review-answer",
        title: "정답과 풀이 적어서 제출하기",
        lead: "문제 아래쪽에 입력 칸이 있습니다. 정답만 필수이고 나머지는 선택입니다.",
        shot: { src: "/guide/04-answer.webp", w: 1180, h: 668, alt: "제출 양식 — 정답, 기호 버튼, 풀이, 풀이 사진, 제출, 포기하고 다른 문항 받기, 임시 저장 안내" },
        points: [
          <><b>정답</b>(필수) — 객관식은 번호, 주관식은 값을 적습니다. 아래 기호 버튼(√, π, ² …)을 누르면 입력 칸에 바로 들어갑니다.</>,
          <><b>풀이</b>(선택) — 짧게라도 적어 주시면 학생 보고서의 해설로 쓰입니다.</>,
          <><b>풀이 사진</b>(선택) — <b>사진 찍기</b>로 손으로 푼 종이를 바로 찍거나, <b>앨범에서 고르기</b>로 미리 찍어 둔 사진·화면 캡처를 올릴 수 있습니다. 휴대폰으로 찍은 큰 사진도 올리기 전에 자동으로 알맞게 줄여 줍니다.</>,
          <><b>제출</b> — 누르는 즉시 정답이 반영되고 포인트가 들어옵니다.</>,
          <>풀기 어려운 문항이면 <b>포기하고 다른 문항 받기</b>를 누르세요. 불이익은 없고, 포기한 문항은 선생님께 다시 배정되지 않습니다.</>,
          <>적고 있던 정답·풀이는 <b>이 기기에 자동으로 임시 저장</b>됩니다. 다른 앱에 갔다 오거나 창이 닫혀도 다시 열면 이 안내와 함께 되살아납니다(사진은 다시 올려야 합니다).</>,
        ],
      },
      {
        id: "review-done",
        title: "제출 완료 — 포인트 확인",
        lead: "제출하면 바로 이 화면이 나옵니다.",
        shot: { src: "/guide/05-done.webp", w: 1180, h: 226, alt: "제출 완료 화면 — +1P 적립 메시지, 다음 문항 받기, 포인트 배지" },
        points: [
          <>+1P가 적립됐다는 메시지가 나옵니다.</>,
          <><b>다음 문항 받기</b>로 계속 이어서 풀 수 있습니다.</>,
          <>오른쪽 위 <b>포인트</b> 숫자가 늘어난 것을 확인할 수 있습니다.</>,
        ],
        tip: <>제출한 문항 중 일부(약 15%)는 다른 선생님이 모르는 상태로 한 번 더 풀어 답을 맞춰 봅니다(사후 검증). 답이 서로 다르면 내 활동의 <b>사후 검증 불일치</b> 숫자가 올라가고 원장님이 확인합니다.</>,
      },
    ],
  },
  {
    id: "store",
    title: "2단계 · 기출 스토어에서 기출문제 받기",
    summary: "모은 포인트로 시험을 구매합니다. 한 번 구매한 시험은 몇 번이든 다시 받을 수 있습니다.",
    steps: [
      {
        id: "store-list",
        title: "시험 고르고 구매하기",
        lead: "기출 스토어에는 검토가 끝난 시험이 모두 올라와 있고, 시험 목록과 같은 폴더로 정리돼 있습니다.",
        shot: { src: "/guide/06-store.webp", w: 1180, h: 960, alt: "기출 스토어 — 연도·학교급·학년·학기·중간/기말 폴더, 3P로 구매, 관리하기, PDF 준비 중, 검토 대기중, 구매 내역" },
        points: [
          <><b>폴더</b>를 눌러 펼치고 접습니다. 연도 → 중학교/고등학교 → 학년 → 학기 → 중간/기말 순서로 들어가면 시험이 나옵니다. 폴더 옆 초록 배지는 그 안에서 이미 산 시험 수입니다. 폴더 없이 한 번에 보고 싶으면 위쪽 <b>전체 목록</b>을 누르세요.</>,
          <><b>3P로 구매</b> — 누르면 포인트 3이 빠지고 그 시험이 선생님 것이 됩니다.</>,
          <>이미 산 시험은 <b>관리하기</b> 버튼으로 바뀝니다. 여기서 PDF·학생 제출·보고서를 모두 다룹니다(아래 3단계).</>,
          <><b>PDF 준비 중</b> — 시험지 파일을 아직 올리는 중인 시험입니다. 준비되면 구매 버튼이 생깁니다.</>,
          <><b>검토 대기중</b> — 아직 검토가 끝나지 않은 시험입니다. 검토에 참여하면 더 빨리 스토어에 올라옵니다.</>,
          <><b>구매 내역</b> — 내가 산 시험만 모아 볼 수 있습니다.</>,
        ],
      },
    ],
  },
  {
    id: "manage",
    title: "3단계 · 구매한 시험 관리하기",
    summary: "“관리하기”를 누르면 탭 세 개가 있는 화면이 열립니다.",
    steps: [
      {
        id: "manage-download",
        title: "기출문제 PDF 받기",
        lead: "학생에게 나눠 줄 시험지를 받습니다.",
        shot: { src: "/guide/07-download.webp", w: 1180, h: 508, alt: "관리 화면 다운로드 탭 — 탭 메뉴, PDF 받기, 선생님 전용 제출 링크와 링크 복사" },
        points: [
          <>위쪽 <b>탭</b>으로 다운로드 / 제출 학생·보고서 / 수정 요청을 오갑니다.</>,
          <><b>PDF 받기</b> — 원본 뒤쪽의 정답·해설 쪽은 빼고 문제만 남긴 시험지가 받아집니다. 앞에는 표지, 맨 뒤에는 <b>선생님 전용 답안 제출 QR</b>이 붙어 있습니다.</>,
          <><b>선생님 전용 제출 링크</b> — QR 대신 카톡 등으로 보낼 때 <b>링크 복사</b>를 누르세요.</>,
        ],
        tip: <>이 QR·링크로 제출한 학생만 선생님 화면에 보입니다. 학원 학생이나 다른 선생님 학생의 제출은 보이지 않습니다.</>,
      },
      {
        id: "manage-student",
        title: "학생이 답 제출하기 (학생 휴대폰 화면)",
        lead: "학생이 QR을 찍거나 링크를 열면 이 화면이 나옵니다. 로그인은 필요 없습니다.",
        shot: { src: "/guide/10-student.webp", w: 560, h: 438, alt: "학생 제출 화면 — 이름, 문항별 답 선택, 제출하기" },
        points: [
          <>학생이 <b>이름</b>을 적습니다.</>,
          <>문항마다 답을 고르거나(객관식) 적습니다(주관식).</>,
          <><b>제출하기</b>를 누르면 바로 채점되어 선생님 화면에 올라옵니다.</>,
        ],
        tip: <>같은 이름으로 두 번 제출할 수는 없습니다. 동명이인이 있으면 &ldquo;김민준A&rdquo;처럼 구분해서 적게 해 주세요.</>,
      },
      {
        id: "manage-report",
        title: "채점 결과·성적 보고서·전체 해설지 받기",
        lead: "“제출 학생·보고서” 탭에서 점수를 확인하고 보고서를 PDF로 만듭니다. 보고서 칸에는 처음에 “불러오기” 버튼만 있으니 먼저 눌러 주세요.",
        shot: { src: "/guide/08-results.webp", w: 1180, h: 882, alt: "제출 학생·보고서 탭 — 종합 보고서 PDF 만들기, 전체 문제 해설지 PDF 받기, 개별 보고서 ZIP 받기, 학생 목록" },
        points: [
          <><b>종합 보고서 PDF 만들기</b> — 제출한 학생 전체의 평균·문항별 정답률 등을 한 파일로 만듭니다.</>,
          <>학생을 체크한 뒤 <b>개별 보고서</b>를 받습니다. 여러 명이면 ZIP 파일 하나로, 한 명이면 이름 옆 <b>PDF</b>로 바로 받을 수 있습니다.</>,
          <>아래 표에서 학생 이름을 누르면 그 학생이 문항별로 무엇을 맞고 틀렸는지 볼 수 있습니다.</>,
          <><b>전체 문제 해설지 PDF 받기</b> — 모든 문항의 빠른 정답표와 문항별 문제·정답·풀이를 모은 해설지입니다. 수업 자료로 쓰기 좋고, 제출한 학생이 없어도 받을 수 있습니다.</>,
        ],
        tip: <>보고서는 버튼을 누른 뒤 브라우저에서 직접 만들어지므로 학생이 많으면 수십 초 걸릴 수 있습니다. 끝날 때까지 창을 닫지 말아 주세요.</>,
      },
      {
        id: "manage-edit",
        title: "정답·해설이 틀렸을 때 수정 요청하기",
        lead: "“해설·정답 수정 요청” 탭에서 고칠 내용을 보내면 원장님이 확인한 뒤 반영합니다.",
        shot: { src: "/guide/09-edit.webp", w: 1180, h: 696, alt: "수정 요청 탭 — 문항 펼치기, 고칠 정답과 메모, 고친 해설, 수정 요청 보내기, 내 요청 상태" },
        points: [
          <>틀린 문항 번호를 눌러 펼칩니다. 지금 저장된 해설이 보입니다.</>,
          <><b>고칠 정답</b>과 <b>메모(이유)</b>를 적습니다.</>,
          <>해설도 고치고 싶으면 <b>고친 해설</b>에 적습니다(선택).</>,
          <><b>수정 요청 보내기</b>를 누릅니다.</>,
          <>보낸 요청은 문항 옆에 <b>내 요청: 확인 대기</b>로 표시되고, 원장님이 확인하면 &ldquo;반영됨&rdquo; 또는 &ldquo;반영 안 함&rdquo;으로 바뀝니다.</>,
        ],
        tip: <>정답이 반영되면 이미 제출한 학생들의 점수도 자동으로 다시 채점됩니다.</>,
      },
    ],
  },
  {
    id: "bugs",
    title: "버그 신고하기",
    summary: "화면이 이상하거나 버튼이 안 되거나 포인트·구매가 이상하면 위쪽 메뉴 “버그 신고”로 알려 주세요.",
    steps: [
      {
        id: "bugs-send",
        title: "신고 보내고 답변 확인하기",
        lead: "종류·제목·내용만 적으면 됩니다. 원장님이 확인하면 같은 화면 아래에 처리 상태와 답변이 표시됩니다.",
        shot: { src: "/guide/12-bugs.webp", w: 1180, h: 962, alt: "버그 신고 화면 — 종류, 제목과 화면, 내용, 스크린샷, 신고 보내기, 내가 보낸 신고의 상태와 원장님 답변" },
        points: [
          <><b>종류</b>를 고릅니다 — 화면·기능 오류 / 문제·해설 오류 / 포인트·구매 / 기타.</>,
          <><b>제목</b>과, 알면 <b>어느 화면·시험·문항</b>에서 생겼는지 적습니다.</>,
          <><b>무슨 일이 있었는지</b> “무엇을 눌렀을 때 → 어떻게 됐는지 → 원래는 어떻게 돼야 하는지” 순서로 적어 주시면 가장 빨리 고칠 수 있습니다.</>,
          <><b>스크린샷</b>(선택) — 화면을 캡처해 올려 주세요. 큰 사진은 자동으로 줄여서 올라갑니다.</>,
          <><b>신고 보내기</b>를 누르면 접수됩니다. 적던 내용은 이 기기에 임시 저장돼서 다른 앱에 다녀와도 남아 있습니다.</>,
          <><b>내가 보낸 신고</b>에서 처리 상태(접수 → 확인 중 → 해결/보류)와 <b>원장님 답변</b>을 확인할 수 있습니다.</>,
        ],
        tip: <>문항 하나의 정답·해설만 고치면 되는 경우에는 구매한 시험의 <b>해설·정답 수정 요청</b> 탭(3단계)을 쓰면 바로 그 문항에 반영돼 더 빠릅니다. 신고는 하루 10건까지 보낼 수 있습니다.</>,
      },
    ],
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "포인트는 어떻게 모으고 어디에 쓰나요?", a: <>검토 1문항 제출 = <b>+1P</b>, 기출 시험 1개 구매 = <b>−3P</b>입니다. 처음 과외선생님 권한을 받으면 <b>환영 포인트 3P</b>가 들어와 시험 1개를 바로 받아 볼 수 있습니다. 돈으로 사고팔 수는 없습니다.</> },
  { q: "휴대폰에서 다른 앱에 갔다 왔더니 풀던 문제가 사라졌어요.", a: <>문항은 1시간 동안 그대로 선생님 몫입니다. 위쪽 메뉴 <b>맡은 문제</b>에서 <b>이어서 풀기</b>를 누르면 적던 답·풀이까지 다시 열립니다.</> },
  { q: "한 번 산 시험을 다시 받으면 포인트가 또 빠지나요?", a: <>아니요. 구매 내역이나 스토어의 <b>관리하기</b>에서 언제든 무료로 다시 받을 수 있습니다.</> },
  { q: "“다음 문항 받기”를 눌렀는데 문항이 안 나와요.", a: <>지금 검토할 문항이 모두 끝난 상태입니다. 새 시험이 올라오면 다시 생기니 나중에 들어와 주세요.</> },
  { q: "제출하려는데 “선점이 만료됐다”고 나와요.", a: <>문항을 받은 뒤 1시간이 지나 다른 분께 넘어갈 수 있는 상태가 된 것입니다. <b>다음 문항 받기</b>로 새로 받아 주세요.</> },
  { q: "“사후 검증 불일치”가 올라갔어요. 불이익이 있나요?", a: <>다른 선생님의 답과 달랐다는 뜻일 뿐, 포인트가 빠지지는 않습니다. 원장님이 두 답을 비교해 맞는 쪽으로 정리합니다. 반복되면 원장님이 따로 연락드릴 수 있습니다.</> },
  { q: "“새 검토 문항 배정이 잠시 멈춰 있다”고 나와요.", a: <>사후 검증에서 다른 선생님 답과 다른 경우가 여러 번 있어 원장님이 확인하는 중이라는 뜻입니다. 그동안에도 기출 스토어와 구매한 시험 관리는 그대로 쓸 수 있으니, 궁금한 점은 원장님께 문의해 주세요.</> },
  { q: "문제 이미지가 잘려 보이거나 다른 번호 문제가 나와요.", a: <><b>전체 쪽 보기</b>로 시험지 한 쪽을 통째로 보고, 필요하면 <b>이전 쪽 / 다음 쪽</b>으로 넘겨 가며 풀어 주세요. 자주 그러면 원장님께 시험 이름과 번호를 알려 주시면 바로잡겠습니다.</> },
  { q: "사이트가 이상하게 동작해요. 어디에 알려야 하나요?", a: <>위쪽 메뉴 <b>버그 신고</b>에서 보내 주세요. 스크린샷을 함께 올리면 훨씬 빨리 고칠 수 있고, 처리 상태와 답변도 같은 화면에서 볼 수 있습니다.</> },
  { q: "학생 제출이 제 화면에 안 보여요.", a: <>학생이 <b>선생님 전용 QR이나 링크</b>로 들어왔는지 확인해 주세요. 학원용 일반 링크로 제출하면 선생님 화면에는 보이지 않습니다.</> },
];

function Num({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
      {n}
    </span>
  );
}

const TABS: { id: string; label: string }[] = [
  { id: "start", label: "시작하기" },
  { id: "review", label: "1 · 검토하고 포인트 받기" },
  { id: "store", label: "2 · 기출 스토어" },
  { id: "manage", label: "3 · 구매한 시험 관리" },
  { id: "bugs", label: "버그 신고" },
  { id: "faq", label: "자주 묻는 질문" },
];

function StepCard({ st }: { st: Step }) {
  return (
    <div id={st.id} className="card space-y-4 scroll-mt-4">
      <div>
        <h3 className="font-medium">{st.title}</h3>
        <p className="text-sm text-slate-500">{st.lead}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={st.shot.src}
          width={st.shot.w}
          height={st.shot.h}
          alt={st.shot.alt}
          loading="lazy"
          className="mx-auto h-auto w-full"
          style={{ maxWidth: st.shot.w }}
        />
      </div>
      <ol className="space-y-2">
        {st.points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <Num n={i + 1} />
            <span className="pt-0.5">{p}</span>
          </li>
        ))}
      </ol>
      {st.tip && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>알아두기</b> · {st.tip}
        </p>
      )}
    </div>
  );
}

export default async function TutorGuidePage({ searchParams }: { searchParams: { tab?: string } }) {
  await requireTutor();
  const tab = TABS.some((t) => t.id === searchParams.tab) ? (searchParams.tab as string) : "start";
  const idx = TABS.findIndex((t) => t.id === tab);
  const prev = idx > 0 ? TABS[idx - 1] : null;
  const next = idx < TABS.length - 1 ? TABS[idx + 1] : null;
  const sec = SECTIONS.find((x) => x.id === tab);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">사용법</h1>
        <p className="text-sm text-slate-500">
          처음 오셨다면 아래 탭을 왼쪽부터 순서대로 눌러 보세요. 그림 속 <span className="font-medium text-rose-600">빨간 번호</span>가
          그림 아래 설명 번호와 같습니다. (그림은 예시 화면이라 이름·점수 등은 실제와 다릅니다.)
        </p>
        {/* 휴대폰에서도 모든 탭이 한눈에 보이도록 옆으로 밀지 않고 줄을 바꿔 보여 준다 */}
        <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/tutor/guide?tab=${t.id}`}
              scroll={false}
              className={
                "rounded-full border px-3 py-1.5 text-sm whitespace-nowrap " +
                (t.id === tab
                  ? "border-slate-900 bg-slate-900 font-medium text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-400")
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {tab === "start" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["1", "검토하고 포인트 받기", "문항 1개 = 1P", "review"],
            ["2", "기출 스토어에서 구매", "시험 1개 = 3P", "store"],
            ["3", "학생 제출·보고서·해설지", "QR·링크로 제출", "manage"],
          ].map(([n, t, sub, id]) => (
            <Link key={n} href={`/tutor/guide?tab=${id}`} scroll={false} className="card flex items-center gap-3 hover:border-slate-300">
              <span className="text-2xl font-semibold text-rose-600">{n}</span>
              <span>
                <span className="block text-sm font-medium text-slate-900">{t}</span>
                <span className="block text-xs text-slate-500">{sub}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {sec && (
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-base font-semibold">{sec.title}</h2>
            <p className="text-sm text-slate-500">{sec.summary}</p>
            {sec.steps.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {sec.steps.map((st, i) => (
                  <a key={st.id} href={`#${st.id}`} className="badge bg-slate-100 text-slate-700 hover:bg-slate-200">
                    {i + 1}. {st.title}
                  </a>
                ))}
              </div>
            )}
          </div>
          {sec.steps.map((st) => (
            <StepCard key={st.id} st={st} />
          ))}
        </section>
      )}

      {tab === "faq" && (
        <section className="space-y-3">
          <div className="border-b border-slate-200 pb-2">
            <h2 className="text-base font-semibold">자주 묻는 질문</h2>
          </div>
          <div className="card divide-y divide-slate-100 py-1">
            {FAQ.map((f) => (
              <details key={f.q} className="py-2">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">{f.q}</summary>
                <p className="mt-2 text-sm text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        {prev ? (
          <Link href={`/tutor/guide?tab=${prev.id}`} className="btn-secondary">
            ← {prev.label}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/tutor/guide?tab=${next.id}`} className="btn-primary">
            다음: {next.label} →
          </Link>
        ) : (
          <Link href="/tutor/review" className="btn-primary">
            검토하러 가기
          </Link>
        )}
      </div>
    </div>
  );
}
