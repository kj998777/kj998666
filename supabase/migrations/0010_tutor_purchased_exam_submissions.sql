-- #109: 과외선생님이 구매한(스토어에 올라온) 시험은 본인 학생들에게 기존 제출 링크(/s/[code])를
-- 그대로 나눠주고 답을 받을 수 있어야 한다. 원장님 확인(2026-09-28): 과외선생님의 개인 학생 제출이
-- 학교 원본 학생 제출과 같은 submissions/grading_results 테이블에 섞이는 것은 문제없음(오히려
-- 데이터 수집 목적에 부합한다고 확인받음) — 그래서 격리 테이블 없이 기존 제출·채점 파이프라인을
-- 그대로 재사용한다.
--
-- 시험이 "닫힘" 상태가 되어야 과외선생님 스토어에 고정 3P로 자동 등록되는데(#108, 0009 마이그레이션),
-- /s/[code] 제출 화면과 submit_and_grade RPC는 지금까지 "열림" 상태만 제출을 받았다. 이 마이그레이션은
-- "스토어에 판매 중(tutor_download_cost가 null이 아님)"인 시험도 제출을 받도록 조건을 넓힌다 —
-- 원래 학교 상태(status)는 '닫힘' 그대로 유지해서 직원 쪽 화면·흐름에는 영향이 없다. 링크(코드) 자체는
-- 예전부터 비공개 토큰이 아니라 "코드를 아는 사람은 제출 가능"이었으므로(로그인 불필요), 이 조건
-- 확장도 같은 신뢰 모델을 그대로 따른다.

create or replace function public.submit_and_grade(
  p_exam_code text,
  p_class_label text,
  p_student_name text,
  p_answers jsonb,
  p_per_item jsonb,
  p_total_score numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_status text;
  v_tutor_cost int;
  v_submission_id uuid;
begin
  select id, status, tutor_download_cost into v_exam_id, v_status, v_tutor_cost
  from public.exams
  where code = p_exam_code
  for update;

  if v_exam_id is null then
    raise exception '존재하지 않는 시험입니다.' using errcode = 'P0020';
  end if;

  if v_status <> '열림' and v_tutor_cost is null then
    raise exception '이 시험은 지금 제출을 받지 않습니다.' using errcode = 'P0021';
  end if;

  begin
    insert into public.submissions (exam_id, class_label, student_name, answers)
    values (v_exam_id, p_class_label, p_student_name, p_answers)
    returning id into v_submission_id;
  exception
    when unique_violation then
      raise exception '이미 같은 이름으로 제출한 기록이 있습니다.' using errcode = 'P0022';
  end;

  insert into public.grading_results (submission_id, exam_id, per_item, total_score)
  values (v_submission_id, v_exam_id, p_per_item, p_total_score);

  return v_submission_id;
end;
$$;

-- #109: 과외선생님이 실제로 구매한(tutor_exam_purchases에 기록이 있는) 시험만 제출 현황을 볼 수
-- 있게 한다 — 스토어에 올라온 모든 시험이 아니라, 본인이 구매한 시험으로 한정.
drop policy if exists "submissions_select_tutor_purchased" on public.submissions;
create policy "submissions_select_tutor_purchased"
  on public.submissions for select to authenticated
  using (
    public.is_tutor()
    and exists (
      select 1 from public.tutor_exam_purchases p
      where p.exam_id = submissions.exam_id and p.tutor_id = auth.uid()
    )
  );

drop policy if exists "grading_results_select_tutor_purchased" on public.grading_results;
create policy "grading_results_select_tutor_purchased"
  on public.grading_results for select to authenticated
  using (
    public.is_tutor()
    and exists (
      select 1 from public.tutor_exam_purchases p
      where p.exam_id = grading_results.exam_id and p.tutor_id = auth.uid()
    )
  );
