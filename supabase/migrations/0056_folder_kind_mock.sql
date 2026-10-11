-- 0056 (2026-10-11 원장님 "2027학년도라 폴더는 2026 → 고3 → 모의고사로 정리")
--   exams.folder_kind에 '모의고사' 추가. 폴더 화면은 학기 자리에 "모의고사" 폴더를 두고 그 안에 바로 시험을 보여 준다
--   (ExamFolderTree·StoreFolderTree). 고3 사설 모의고사(0053 mock_csat)는 만들 때 모의고사로 들어간다(mock-actions.ts).
alter table public.exams drop constraint if exists exams_folder_kind_check;
alter table public.exams add constraint exams_folder_kind_check
  check (folder_kind in ('중간', '기말', '기타', '모의고사') or folder_kind is null);

-- 이미 올린 고3 사설 모의고사는 모의고사 폴더로(학기는 비움). 이름이 "2027 …"(학년도)인 0회는 2026 폴더로.
update public.exams set folder_kind = '모의고사', folder_term = null where mock_csat and (folder_kind is distinct from '모의고사' or folder_term is not null);
update public.exams set folder_year = '2026' where mock_csat and folder_year = '2027' and name like '2027%';

-- 확인
select code, folder_year, school_level, folder_grade, folder_term, folder_kind from public.exams where mock_csat order by created_at;
