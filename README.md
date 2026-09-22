# 학원 시험관리 시스템 (v1)

시험·정답 관리, 반 관리, 학생 제출·자동채점, 채점 결과 확인, 계정·권한 관리(관리자/편집자/뷰어)를
갖춘 새 웹사이트입니다. 기존 구글 Apps Script 시스템(AI 자동채점, PDF 보고서, QR, 시험지
디지털화 등)은 그대로 두고, 이 사이트는 "같은 학원 안에서 여러 선생님이 계정으로 나눠 쓰는" 핵심
기능만 담당합니다.

## 권한 3단계

- **관리자(admin)**: 전부 가능 — 계정 관리, 시험·정답·반 관리, 채점 결과 확인, **시험 열기/닫기**, 삭제
- **편집자(editor)**: 시험·정답 등록, 반 관리(추가/삭제), 채점 결과 확인. **열기/닫기·삭제는 불가**
- **뷰어(viewer)**: 조회만 가능

---

## 1. 처음 배포하기 (원장님이 직접 하실 일)

아래는 전부 무료 요금제로 충분합니다(이 규모 기준 월 0원).

### 1-1. Supabase 프로젝트 만들기 (약 10분)

1. https://supabase.com 에서 계정을 만들고 새 프로젝트를 만듭니다. DB 비밀번호는 직접 정해서
   안전한 곳에 보관하세요(이후 다시 안 쓰지만 분실 시 재설정이 번거롭습니다).
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** 를 열고, 이 저장소의
   `supabase/migrations/0001_init.sql` 내용을 그대로 붙여넣어 실행합니다. (한 번만 하면 됩니다.)
3. 왼쪽 메뉴 **Project Settings → API** 에서 아래 세 값을 복사해 둡니다.
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY` (**절대 외부에 공유 금지** — 이 키가 있으면
     보안 규칙을 다 건너뛸 수 있습니다)
4. **Authentication → URL Configuration** 에서 Site URL을 나중에 정할 실제 배포 주소(예:
   `https://academy-app.vercel.app`)로 설정합니다(배포 뒤에 다시 와서 채워도 됩니다).
5. **Authentication → Email Templates**(선택)에서 초대 메일 문구를 한국어로 다듬어도 됩니다.

### 1-2. Vercel에 배포하기 (약 10~15분)

이 압축파일 안에는 이미 `git init` + 첫 커밋까지 해 둔 저장소가 들어 있습니다(`.git` 폴더 포함).
GitHub에 빈 저장소만 하나 만들고 아래처럼 바로 올리면 됩니다.

1. https://github.com/new 에서 빈 저장소를 하나 만듭니다(예: `academy-app`, Public/Private 상관없음,
   "Add a README" 등 초기 파일 옵션은 전부 체크 해제).
2. 이 폴더(압축을 푼 `academy-app/`)에서 터미널을 열고:
   ```bash
   git remote add origin https://github.com/<본인계정>/academy-app.git
   git branch -M main
   git push -u origin main
   ```
3. https://vercel.com 에서 GitHub 계정으로 로그인하고, 방금 올린 저장소를 "Import" 합니다.
   프레임워크는 Next.js로 자동 인식됩니다.
3. 배포 설정 화면의 **Environment Variables** 에 아래 4개를 넣습니다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` = 배포 후 받을 주소(예: `https://academy-app.vercel.app`).
     모르면 일단 아무 값이나 넣고 배포 뒤 실제 주소로 다시 저장 → 재배포하면 됩니다.
4. Deploy를 누르면 Vercel이 저장소를 가져가 `npm install` + 빌드를 자기 서버에서 수행합니다
   (이 프로젝트 코드 작성 환경에서는 사내 네트워크 정책으로 `npm install`을 직접 돌려볼 수
   없었기 때문에, 실제 빌드는 이 1-2 단계에서 처음 이루어집니다 — 오류가 나면 Vercel의 빌드 로그를
   그대로 저에게 보여주시면 바로 고쳐드릴 수 있습니다).
5. 배포가 끝나면 나온 주소를 Supabase의 **Authentication → URL Configuration → Site URL** 과
   Vercel 환경변수 `NEXT_PUBLIC_SITE_URL` 에 다시 반영하고 재배포합니다.

### 1-3. 첫 관리자(원장님) 계정 만들기 (약 5분)

1. 배포된 사이트의 `/login` 에서 본인 이메일로 로그인 링크를 요청합니다.
2. 메일이 안 오면 Supabase **Authentication → Users** 에서 "Invite user"로 본인 이메일을 직접
   초대해도 됩니다.
3. 로그인 링크를 눌러 로그인에 성공하면(권한이 없다는 화면이 나올 수 있음 — 정상입니다),
   Supabase **SQL Editor** 에서 아래 한 줄을 실행합니다(이메일만 본인 것으로 바꾸세요).

   ```sql
   update public.profiles set role = 'admin' where email = 'your-email@example.com';
   ```

4. 다시 로그인하면(또는 새로고침) 관리자 화면(`/admin/users`)이 보입니다. 이제부터는 이 화면에서
   동료 선생님을 초대하고 권한을 정하면 되고, 이 SQL 단계는 최초 1회만 필요합니다.

### 1-4. 기존 구글 시트 데이터 옮기기 (선택, 원하실 때 진행)

`scripts/migrate.ts` 참고. 요약하면:

1. 원본 구글 시트에서 CSV로 내려받습니다: "반목록" → `classes.csv`, "시험목록" → `exams.csv`,
   "정답" → `answer_key.csv`, 시험별 "제출_코드" 탭 → `submissions_코드.csv`. 전부
   `scripts/data/` 폴더 안에 넣습니다(이 폴더는 git에 올라가지 않게 되어 있습니다).
2. 프로젝트 루트에 `.env.local` 을 만들고 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   를 채웁니다(`.env.example` 참고).
3. `npm install` 후 `npm run migrate` 를 실행합니다.
4. 가상 반·테스트 제출 기록(DG2025 가상A~D, TEST 등)도 원본에 있는 그대로 함께 옮겨집니다.
   나중에 필요 없으면 사이트의 반 관리/채점 결과 화면에서 직접 지우면 됩니다.

---

## 2. 로컬에서 개발/테스트하려면

이 코드를 작성한 환경은 사내 네트워크 정책으로 `npm install` 자체가 막혀 있어서, 실제로
`npm run dev` 를 돌려서 화면을 확인하는 것은 이 문서를 읽는 분의 컴퓨터(또는 Vercel)에서
처음 이루어지게 됩니다. 아래 순서로 확인해 주세요.

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

채점 로직만 따로(패키지 설치 없이) 검증하려면:

```bash
npm run test:grading
```

(이 테스트는 이미 이 코드를 작성하면서 34개 모두 통과 확인했습니다 — 분수/원문자/전각숫자/√/제곱/
×÷/pi/부등호/복수정답 등 기존 시스템과 동일한 동치 규칙입니다.)

---

## 3. 폴더 구조

```
app/s/[code]/                  # 공개 학생 제출 화면
app/api/submit/[code]/         # 신뢰되는 유일한 제출 처리 경로(서비스롤 키)
app/login, app/auth/callback   # 로그인(매직 링크)
app/(staff)/...                # 로그인+역할 검사 뒤의 관리 화면
  dashboard/                   # 첫 화면
  admin/users/                 # 계정 관리(관리자 전용)
  classes/                     # 반 관리(편집자 이상)
  exams/[code]/                # 시험·정답 관리 + 열기/닫기(관리자 전용)
  exams/[code]/results/        # 채점 결과(뷰어 이상 조회, 관리자만 삭제)
lib/grading.ts                 # 채점 정규화 로직(순수 함수, 단위 테스트 있음)
lib/classLabel.ts              # "고1 2반" 라벨 생성 + 반 이름 정리
lib/auth/requireRole.ts        # 역할 검사(이중 방어: 화면 + 서버 액션 양쪽에서 검사)
lib/supabase/{client,server,admin}.ts  # 브라우저용 / 세션용 / 서비스롤용 클라이언트
supabase/migrations/0001_init.sql      # 전체 스키마 + RLS 정책 + 채점 기록 함수
scripts/migrate.ts             # 구글시트 → Supabase 1회성 이전 스크립트
```

## 4. 알아두면 좋은 설계 결정

- **시험 열기/닫기는 관리자만** 가능하도록 화면(버튼 숨김) + 서버 액션 + DB 트리거, 세 군데에서
  같은 규칙을 강제합니다(하나가 뚫려도 나머지가 막습니다).
- **학생 제출은 서비스롤 키를 쓰는 서버 라우트 하나(`/api/submit/[code]`)만** 처리합니다.
  클라이언트가 보낸 학교급/학년/반 값은 그대로 믿지 않고 서버가 `classes` 테이블과 대조해서
  실제 라벨을 직접 만들고, 정답은 학생 쪽 응답에 절대 포함하지 않습니다.
- **정답(`answer_key`)과 제출 원본(`submissions`)은 직원(admin/editor/viewer)만 조회**할 수
  있고, 익명 사용자에게는 RLS로 원천 차단되어 있습니다.
- 이번 v1에는 AI 자동채점·PDF 보고서·QR·시험지 디지털화가 없습니다. 필요하면 이후 버전에서
  Anthropic API 연동을 추가로 붙일 수 있습니다(그때부터 API 사용료가 별도 발생).
