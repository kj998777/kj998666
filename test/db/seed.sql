-- 보안 점검용 가짜 데이터(실제 학생·선생님 아님). test/db/security.sh가 씀.
-- 사용자: 관리자 a1, 편집자 e1, 뷰어 v1, 과외 t1(구매함) t2, 대기 w1
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x'),('00000000-0000-0000-0000-0000000000e1','ed@x'),('00000000-0000-0000-0000-0000000000f1','vw@x'),
 ('00000000-0000-0000-0000-000000000011','t1@x'),('00000000-0000-0000-0000-000000000012','t2@x'),('00000000-0000-0000-0000-0000000000b1','wait@x');
alter table profiles disable trigger user;
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';
update profiles set role='editor' where id='00000000-0000-0000-0000-0000000000e1';
update profiles set role='viewer' where id='00000000-0000-0000-0000-0000000000f1';
update profiles set role='tutor' where id in ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012');
alter table profiles enable trigger user;
insert into student_numbers(user_id, student_no) values ('00000000-0000-0000-0000-000000000011','2025XXXX01'),('00000000-0000-0000-0000-000000000012','2025XXXX02');
insert into tutor_stats(tutor_id, points_balance) values ('00000000-0000-0000-0000-000000000011',10),('00000000-0000-0000-0000-000000000012',5) on conflict (tutor_id) do update set points_balance=excluded.points_balance;
insert into exams(id,code,name,status) values ('e0000000-0000-0000-0000-00000000000a','OPEN1','열린시험','열림'),('e0000000-0000-0000-0000-00000000000b','REV1','검토시험','검수대기'),('e0000000-0000-0000-0000-00000000000c','CLOSED1','닫힌시험','닫힘');
insert into answer_key(exam_id,item_label,correct_answers,type) select e, '1','3','객관식' from unnest(array['e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000c']::uuid[]) e;
insert into item_explanations(id,exam_id,item_label,answer_display,solution) values
 ('10000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-00000000000a','1','③','비밀해설A'),
 ('10000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','1','③','비밀해설B'),
 ('10000000-0000-0000-0000-00000000000c','e0000000-0000-0000-0000-00000000000c','1','③','비밀해설C');
insert into classes(level,grade,name) values ('고',1,'2반');
insert into submissions(id,exam_id,class_label,student_name,answers,tutor_id) values
 ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','고1 2반','학생갑','["3"]',null),
 ('50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-00000000000a','과외','학생을','["2"]','00000000-0000-0000-0000-000000000011'),
 ('50000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-00000000000a','과외','학생병','["2"]','00000000-0000-0000-0000-000000000012');
insert into grading_results(submission_id,exam_id,per_item,total_score) select id, exam_id, '[]', 1 from submissions;
insert into exam_notes(exam_id,note) values ('e0000000-0000-0000-0000-00000000000a','메모');
insert into exam_corrections(exam_id,item_label,issue) values ('e0000000-0000-0000-0000-00000000000a','1','x');
insert into exam_pdf_meta(exam_id,storage_path) values ('e0000000-0000-0000-0000-00000000000a','a/x.pdf');
insert into exam_jobs(exam_id,stage) values ('e0000000-0000-0000-0000-00000000000a','done');
insert into digitize_jobs(exam_id,stage) values ('e0000000-0000-0000-0000-00000000000a','dg_done');
insert into digitized_pages(exam_id,page_no,data) values ('e0000000-0000-0000-0000-00000000000a',1,'{}');
insert into item_checks(exam_id,item_label,stage) values ('e0000000-0000-0000-0000-00000000000a','1','rx_done');
insert into item_locate_jobs(exam_id) values ('e0000000-0000-0000-0000-00000000000a');
insert into exam_qr_scans(exam_id) values ('e0000000-0000-0000-0000-00000000000a');
insert into tutor_exam_purchases(tutor_id,exam_id,points_spent) values ('00000000-0000-0000-0000-000000000011','e0000000-0000-0000-0000-00000000000a',3);
insert into tutor_points_ledger(tutor_id,delta,reason) values ('00000000-0000-0000-0000-000000000011',1,'review_primary'),('00000000-0000-0000-0000-000000000012',1,'review_primary');
insert into tutor_item_reviews(item_explanation_id,exam_id,item_label,tutor_id,kind,answer_display) values
 ('10000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','1','00000000-0000-0000-0000-000000000011','primary','③'),
 ('10000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','1','00000000-0000-0000-0000-000000000012','primary','②');
insert into tutor_links(tutor_id,token) values ('00000000-0000-0000-0000-000000000011','tok1tok1tok1tok1tok1tok1tok1tok1'),('00000000-0000-0000-0000-000000000012','tok2tok2tok2tok2tok2tok2tok2tok2');
insert into tutor_edit_requests(exam_id,item_label,tutor_id,note) values ('e0000000-0000-0000-0000-00000000000a','1','00000000-0000-0000-0000-000000000011','n1'),('e0000000-0000-0000-0000-00000000000a','1','00000000-0000-0000-0000-000000000012','n2');
insert into tutor_review_skips(tutor_id,item_explanation_id) values ('00000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-00000000000b');
insert into bug_reports(reporter_id,title,body) values ('00000000-0000-0000-0000-000000000011','t','b');
insert into tutor_gold_attempts(tutor_id,item_explanation_id,exam_id,item_label) values ('00000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-00000000000a','1');
insert into tutor_judgments(tutor_id,correct,source,gold_attempt_id) select '00000000-0000-0000-0000-000000000011',true,'gold',id from tutor_gold_attempts limit 1;
insert into tutor_judgments(tutor_id,correct,source,review_id) select '00000000-0000-0000-0000-000000000012',false,'majority',id from tutor_item_reviews where tutor_id='00000000-0000-0000-0000-000000000012' limit 1;
insert into student_keys(key,memo) values ('반:고1 2반|학생갑','상담');
insert into site_contact(id,kakao_id) values (true,'kid') on conflict (id) do update set kakao_id='kid';
insert into ai_settings(model, api_key) select 'm','sk-secret' where not exists (select 1 from ai_settings);
update ai_settings set api_key='sk-secret';
insert into ai_usage(spent_usd) select 1 where not exists (select 1 from ai_usage);
-- 0042 맞춤 시험지: 스토어 가격(열린시험 3P·닫힌시험 4P, 검토 중 시험은 판매 안 함), tutor2의 시험지 하나
update exams set tutor_download_cost=3 where code='OPEN1';
update exams set tutor_download_cost=4 where code='CLOSED1';
insert into tutor_worksheets(tutor_id,title,item_ids,points_spent) values ('00000000-0000-0000-0000-000000000012','t2시험지',array['10000000-0000-0000-0000-00000000000c']::uuid[],1);
insert into tutor_worksheet_items(tutor_id,item_explanation_id) values ('00000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-00000000000c');
-- 0046 친구 초대: tutor1의 초대 코드, tutor2는 tutor1 초대로 가입(보너스 아직)
insert into tutor_invite_codes(tutor_id,code) values ('00000000-0000-0000-0000-000000000011','ABC234');
insert into tutor_referrals(invitee_id,inviter_id,code) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011','ABC234');
