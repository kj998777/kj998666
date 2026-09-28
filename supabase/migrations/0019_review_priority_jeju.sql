-- 검토 문항 배정 우선순위 (2026-09-28, 원장님 요청).
--
-- 원장님 결정(AskUserQuestion):
--   기준 적용 순서 = ① 정답 등록 횟수 → ② 제주 학교 → ③ 학교급
--     ① 한 번도 답이 등록되지 않은 새 문항 > 한 번 등록된 문항(15% 사후검증 대상). 재배정은 지금처럼
--        "1회 + 사후검증"까지만(그 이상 다시 배정하지 않음).
--     ② 같은 등록 횟수 안에서는 제주도 내 학교 시험 문항 > 타 지역 학교 문항
--     ③ 그 안에서는 고등학교 > 중학교 > 그 밖(초등·미지정)
--     그래도 같으면 예전처럼 가장 오래 기다린 문항부터.
--   제주 학교 판별 = 시험 이름에 든 학교명을 제주 중·고등학교 목록과 비교해 자동 표시 + 시험 상세에서
--   "제주 학교" 체크로 수정 가능(앱: lib/jejuSchools.ts — 아래 목록과 같은 목록에서 만든 것).
--
-- 0016·0017·0018 다음에 실행해야 한다(review_confirmed 열, 0018의 검토 큐 조건을 그대로 이어받음).

-- -------------------------------------------------------------------------
-- 1. exams.is_jeju
-- -------------------------------------------------------------------------
alter table public.exams add column if not exists is_jeju boolean not null default false;

comment on column public.exams.is_jeju is
  '제주도 내 학교 시험인지. 검토 문항 배정 때 우선. 시험을 만들 때 이름으로 자동 표시되고 시험 상세에서 바꿀 수 있다.';

-- -------------------------------------------------------------------------
-- 2. 기존 시험 소급 표시 — 이름에 제주 학교명(정식 이름·줄임말)이 들어 있으면 제주로 표시하고,
--    학교급이 비어 있으면 그 학교의 학교급으로 채운다(가장 긴 이름부터 비교: "제주중앙고"가 "제주중"으로
--    잘못 걸리지 않게).
-- -------------------------------------------------------------------------
with aliases(alias, lvl) as (
  select a, '고' from unnest(array['남녕고등학교', '남녕고', '대기고등학교', '대기고', '세화고등학교', '세화고', '신성여자고등학교', '신성여고', '애월고등학교', '애월고', '영주고등학교', '영주고', '오현고등학교', '오현고', '제주고등학교', '제주고', '제주과학고등학교', '제주과고', '제주대학교사범대학부설고등학교', '제주사대부고', '제주대사대부고', '제주여자고등학교', '제주여고', '제주여자상업고등학교', '제주여상고', '제주여상', '제주외국어고등학교', '제주외고', '제주제일고등학교', '제주제일고', '제주중앙고등학교', '제주중앙고', '제주중앙여자고등학교', '제주중앙여고', '한국뷰티고등학교', '한국뷰티고', '한림고등학교', '한림고', '한림공업고등학교', '한림공고', '함덕고등학교', '함덕고', '남주고등학교', '남주고', '대정고등학교', '대정고', '대정여자고등학교', '대정여고', '삼성여자고등학교', '삼성여고', '서귀포고등학교', '서귀포고', '서귀포산업과학고등학교', '서귀포산과고', '서귀포산업과학고', '서귀포여자고등학교', '서귀포여고', '서귀여고', '성산고등학교', '성산고', '중문고등학교', '중문고', '표선고등학교', '표선고']) a
  union all
  select a, '중' from unnest(array['고산중학교', '고산중', '귀일중학교', '귀일중', '김녕중학교', '김녕중', '노형중학교', '노형중', '세화중학교', '세화중', '신성여자중학교', '신성여중', '신엄중학교', '신엄중', '신창중학교', '신창중', '아라중학교', '아라중', '애월중학교', '애월중', '오름중학교', '오름중', '오현중학교', '오현중', '우도중학교', '우도중', '저청중학교', '저청중', '제주대학교사범대학부설중학교', '제주사대부중', '제주동여자중학교', '제주동여중', '제주동중학교', '제주동중', '제주서중학교', '제주서중', '제주여자중학교', '제주여중', '제주제일중학교', '제주제일중', '제주중앙여자중학교', '제주중앙여중', '제주중앙중학교', '제주중앙중', '제주중학교', '제주중', '조천중학교', '조천중', '추자중학교', '추자중', '탐라중학교', '탐라중', '한라중학교', '한라중', '한림여자중학교', '한림여중', '한림중학교', '한림중', '함덕중학교', '함덕중', '남원중학교', '남원중', '남주중학교', '남주중', '대정중학교', '대정중', '무릉중학교', '무릉중', '서귀중앙여자중학교', '서귀중앙여중', '서귀포대신중학교', '서귀포대신중', '서귀포여자중학교', '서귀포여중', '서귀포중학교', '서귀포중', '성산중학교', '성산중', '신산중학교', '신산중', '안덕중학교', '안덕중', '위미중학교', '위미중', '중문중학교', '중문중', '표선중학교', '표선중', '효돈중학교', '효돈중']) a
),
m as (
  select e.id,
         (select al.lvl from aliases al
          where replace(e.name, ' ', '') like '%' || al.alias || '%'
          order by length(al.alias) desc
          limit 1) as lvl
  from public.exams e
)
update public.exams e
set is_jeju = (m.lvl is not null),
    school_level = coalesce(e.school_level, m.lvl)
from m
where m.id = e.id;

-- -------------------------------------------------------------------------
-- 3. 새 문항 배정(claim_next_review_item) — 0018 본문 + 우선순위 정렬.
--    새 문항(등록 0회)을 먼저 찾고, 없을 때만 사후검증(1회) 대상을 찾는 구조는 그대로라 ①이 자연히
--    가장 먼저 적용된다.
-- -------------------------------------------------------------------------
create or replace function public.claim_next_review_item()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if not public.is_tutor() then
    raise exception '과외선생님 계정만 검토할 수 있습니다.' using errcode = 'P0030';
  end if;

  select ie.id into v_item_id
  from public.item_explanations ie
  join public.exams e on e.id = ie.exam_id
  where e.status = '검수대기'
    and not ie.tutor_reviewed
    and not ie.review_confirmed
    and (ie.claimed_by is null or ie.claim_expires_at < now())
  order by e.is_jeju desc,
           case e.school_level when '고' then 0 when '중' then 1 else 2 end,
           ie.updated_at
  limit 1
  for update of ie skip locked;

  if v_item_id is not null then
    update public.item_explanations
      set claimed_by = auth.uid(), claim_expires_at = now() + interval '30 minutes'
    where id = v_item_id;
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'primary');
  end if;

  v_item_id := public.claim_verification_item();
  if v_item_id is not null then
    return jsonb_build_object('itemExplanationId', v_item_id, 'kind', 'verify');
  end if;

  return null;
end;
$$;

grant execute on function public.claim_next_review_item() to authenticated;

-- -------------------------------------------------------------------------
-- 4. 사후검증 배정(claim_verification_item) — 0004 본문 + 같은 우선순위(제주 → 학교급 → 오래된 순)
-- -------------------------------------------------------------------------
create or replace function public.claim_verification_item()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_item_id uuid;
begin
  select r.id, r.item_explanation_id into v_review_id, v_item_id
  from public.tutor_item_reviews r
  join public.exams e on e.id = r.exam_id
  where r.kind = 'primary'
    and r.needs_verification
    and not r.verified
    and r.tutor_id <> auth.uid()
    and e.status = '검수대기'
    and (r.verify_claimed_by is null or r.verify_claim_expires_at < now())
  order by e.is_jeju desc,
           case e.school_level when '고' then 0 when '중' then 1 else 2 end,
           r.created_at
  limit 1
  for update of r skip locked;

  if v_review_id is null then
    return null;
  end if;

  update public.tutor_item_reviews
    set verify_claimed_by = auth.uid(), verify_claim_expires_at = now() + interval '30 minutes'
  where id = v_review_id;

  return v_item_id;
end;
$$;

-- -------------------------------------------------------------------------
-- 확인용:
--   select name, is_jeju, school_level from public.exams order by is_jeju desc, name;
-- -------------------------------------------------------------------------
