#!/usr/bin/env python3
# 보안·권한 자동 점검(2026-09-30). 로컬 PostgreSQL 16에 Supabase 비슷한 환경(test/db/supabase_stub.sql)을 만들고
# supabase/migrations/*.sql 을 전부 적용한 뒤 가짜 데이터(test/db/seed.sql)를 넣고,
#   1) 역할별(비로그인·관리자·편집자·뷰어·과외선생님 둘·대기) 모든 표의 읽기/고치기/지우기 줄 수를 기대값과 비교하고
#   2) 넣기·위험한 함수 호출이 막히는지 확인한다.
# 쓰는 법:  python3 test/db/security.py  [--host /srv/pg37 --port 5437]   (실패하면 종료 코드 1)
# 표를 새로 만들거나 정책을 바꾸면 아래 EXPECT_* 를 함께 고친다(바뀐 칸이 화면에 나오므로 의도한 변화인지 확인).
import argparse, glob, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--host", default="/srv/pg37")
ap.add_argument("--port", default="5437")
ap.add_argument("--db", default="sectest")
ap.add_argument("--pgbin", default="/usr/lib/postgresql/16/bin")
args = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = [f"{args.pgbin}/psql", "-h", args.host, "-p", args.port, "-U", "postgres", "-X", "-q"]
PSQL = BASE + ["-A", "-t", "-d", args.db]


def sh(cmd, inp=None):
    return subprocess.run(cmd, input=inp, capture_output=True, text=True)


def build():
    sh(BASE + ["-d", "postgres", "-c", f"drop database if exists {args.db}", "-c", f"create database {args.db}"])
    files = [os.path.join(ROOT, "test/db/supabase_stub.sql")] + sorted(glob.glob(os.path.join(ROOT, "supabase/migrations/*.sql"))) + [os.path.join(ROOT, "test/db/seed.sql")]
    for f in files:
        r = sh(BASE + ["-d", args.db, "-v", "ON_ERROR_STOP=1", "-f", f])
        if r.returncode != 0:
            print("적용 실패:", os.path.basename(f), r.stderr.strip()[:300])
            sys.exit(1)


USERS = {
    "anon": (None, "anon"),
    "admin": ("00000000-0000-0000-0000-0000000000a1", "authenticated"),
    "editor": ("00000000-0000-0000-0000-0000000000e1", "authenticated"),
    "viewer": ("00000000-0000-0000-0000-0000000000f1", "authenticated"),
    "tutor1": ("00000000-0000-0000-0000-000000000011", "authenticated"),
    "tutor2": ("00000000-0000-0000-0000-000000000012", "authenticated"),
    "wait": ("00000000-0000-0000-0000-0000000000b1", "authenticated"),
}
ORDER = ["anon", "admin", "editor", "viewer", "tutor1", "tutor2", "wait"]


def as_user(who, body):
    uid, role = USERS[who]
    sql = f"begin;\nupdate auth.cur set uid={repr(uid) if uid else 'null'};\nselect set_config('request.jwt.claim.role','{role}',true) is null;\nset local role {role};\n{body}\nrollback;\n"
    r = sh(PSQL, sql)
    lines = [l for l in r.stdout.split("\n") if l and l != "f"]
    return lines, r.stderr.strip()


# 읽기/고치기/지우기 줄 수 기대값: "S/U/D", x = 권한 자체가 없음(permission denied)
EXPECT_MATRIX = """
ai_settings            0/0/0 1/1/1 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
ai_usage               0/0/0 1/1/1 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
answer_key             0/0/0 3/3/3 3/3/3 3/0/0 0/0/0 0/0/0 0/0/0
bug_reports            0/0/0 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
classes                1/0/0 1/1/1 1/1/1 1/0/0 1/0/0 1/0/0 1/0/0
digitize_jobs          0/0/0 1/1/1 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
digitized_pages        0/0/0 1/1/1 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
exam_corrections       0/0/0 1/1/1 1/1/1 1/0/0 0/0/0 0/0/0 0/0/0
exam_jobs              0/0/0 1/1/1 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
exam_notes             0/0/0 1/0/1 1/0/1 1/0/0 0/0/0 0/0/0 0/0/0
exam_pdf_meta          0/0/0 1/1/1 1/1/0 1/0/0 0/0/0 0/0/0 0/0/0
exam_qr_scans          0/0/0 1/0/0 1/0/0 1/0/0 0/0/0 0/0/0 0/0/0
exams                  1/0/0 3/3/3 3/3/0 3/0/0 2/0/0 2/0/0 0/0/0
grading_results        0/0/0 3/0/0 3/0/0 3/0/0 1/0/0 1/0/0 0/0/0
item_checks            0/0/0 1/1/1 1/0/0 1/0/0 0/0/0 0/0/0 0/0/0
item_explanations      0/0/0 3/3/3 3/3/3 3/0/0 0/0/0 0/0/0 0/0/0
item_locate_jobs       0/0/0 1/0/0 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
profiles               0/0/0 6/0/0 1/0/0 1/0/0 1/0/0 1/0/0 1/0/0
site_contact           0/0/0 1/1/0 1/0/0 1/0/0 1/0/0 1/0/0 1/0/0
student_keys           x/x/x 1/1/1 1/1/1 1/0/0 0/0/0 0/0/0 0/0/0
student_numbers        x/x/x 2/x/x 0/x/x 0/x/x 0/x/x 0/x/x 0/x/x
submissions            0/0/0 3/0/3 3/0/0 3/0/0 1/0/0 1/0/0 0/0/0
tutor_edit_requests    0/0/0 2/2/0 0/0/0 0/0/0 1/0/0 1/0/0 0/0/0
tutor_exam_purchases   0/0/0 1/0/0 0/0/0 0/0/0 1/0/0 0/0/0 0/0/0
tutor_gold_attempts    x/x/x x/x/x x/x/x x/x/x x/x/x x/x/x x/x/x
tutor_item_reviews     0/0/0 2/2/0 2/0/0 0/0/0 1/0/0 1/0/0 0/0/0
tutor_judgments        0/0/0 2/x/x 0/x/x 0/x/x 0/x/x 0/x/x 0/x/x
tutor_links            0/0/0 2/0/0 0/0/0 0/0/0 1/0/0 1/0/0 0/0/0
tutor_points_ledger    0/0/0 2/0/0 0/0/0 0/0/0 1/0/0 1/0/0 0/0/0
tutor_ranking_settings 0/0/0 1/0/0 1/0/0 1/0/0 1/0/0 1/0/0 1/0/0
tutor_review_skips     0/0/0 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0 0/0/0
tutor_stats            0/0/0 2/0/0 0/0/0 0/0/0 1/0/0 1/0/0 0/0/0
"""


def matrix():
    tables = sh(PSQL, "select tablename from pg_tables where schemaname='public' order by 1").stdout.split()
    expect = {l.split()[0]: l.split()[1:] for l in EXPECT_MATRIX.strip().split("\n")}
    fails = 0
    for t in tables:
        col = sh(PSQL, f"select column_name from information_schema.columns where table_schema='public' and table_name='{t}' order by ordinal_position limit 1").stdout.strip()
        got = []
        for who in ORDER:
            body = (
                f"select 'S|'||count(*) from public.{t};\n"
                f"savepoint a;\nwith x as (update public.{t} set \"{col}\"=\"{col}\" returning 1) select 'U|'||count(*) from x;\nrollback to a;\n"
                f"savepoint b;\nwith x as (delete from public.{t} returning 1) select 'D|'||count(*) from x;\nrollback to b;"
            )
            lines, _ = as_user(who, body)
            d = {l.split("|")[0]: l.split("|")[1] for l in lines if "|" in l}
            got.append("/".join(d.get(k, "x") for k in "SUD"))
        exp = expect.get(t)
        if exp != got:
            fails += 1
            print(f"[권한 바뀜] {t}\n   기대 {' '.join(exp) if exp else '(새 표 — 기대값 없음)'}\n   실제 {' '.join(got)}")
    return fails


T1 = "'00000000-0000-0000-0000-000000000011'"
EA = "'e0000000-0000-0000-0000-00000000000a'"
EB = "'e0000000-0000-0000-0000-00000000000b'"
# (설명, 사용자, 실행문, 기대: "deny"=오류로 막힘 / "null"=빈 결과 / "ok"=성공 / "0rows"=0줄)
ATTACKS = [
    ("비로그인 포인트 조정", "anon", f"select public.admin_adjust_tutor_points({T1}, 50, 'x');", "deny"),
    ("비로그인 문항 배정", "anon", "select public.claim_next_review_item();", "deny"),
    ("비로그인 검토 제출", "anon", "select public.submit_tutor_review('10000000-0000-0000-0000-00000000000b','3','풀이풀이풀이풀이',null);", "deny"),
    ("비로그인 랭킹", "anon", "select public.tutor_point_ranking('all',5);", "deny"),
    ("비로그인 등급", "anon", f"select public.tutor_trust_level({T1});", "deny"),
    ("비로그인 정답률", "anon", f"select public.tutor_accuracy({T1});", "deny"),
    ("비로그인 학번 저장", "anon", f"select public.admin_set_student_no({T1},'ZZZZ1111');", "deny"),
    ("비로그인 채점 직접", "anon", f"select public.submit_and_grade('OPEN1','고1 2반','해커','[]','[]',100,null);", "deny"),
    ("비로그인 제출 직접 넣기", "anon", f"insert into submissions(exam_id,class_label,student_name,answers) values ({EA},'고1 2반','해커','[]');", "deny"),
    ("대기 포인트 조정", "wait", f"select public.admin_adjust_tutor_points({T1}, 50, 'x');", "deny"),
    ("대기 옛 사후검증 배정", "wait", "select public.claim_verification_item();", "deny"),
    ("대기 랭킹", "wait", "select public.tutor_point_ranking('all',5);", "null"),
    ("비로그인 기수별 랭킹", "anon", "select public.tutor_cohort_ranking('all');", "deny"),
    ("대기 기수별 랭킹", "wait", "select public.tutor_cohort_ranking('all');", "null"),
    ("뷰어 기수별 랭킹", "viewer", "select public.tutor_cohort_ranking('all');", "null"),
    ("뷰어 포인트 조정", "viewer", f"select public.admin_adjust_tutor_points({T1}, 50, 'x');", "deny"),
    ("뷰어 해설 고치기", "viewer", "update item_explanations set solution='x' returning 1;", "0rows"),
    ("편집자 시험 열기", "editor", f"update exams set status='열림' where id={EB} returning 1;", "deny"),
    ("과외 포인트 직접 올리기", "tutor1", f"update tutor_stats set points_balance=9999 where tutor_id={T1} returning 1;", "0rows"),
    ("과외 원장 권한 올리기", "tutor1", "update profiles set role='admin' where id=auth.uid() returning 1;", "0rows"),
    ("과외 포인트 조정", "tutor1", f"select public.admin_adjust_tutor_points({T1}, 50, 'x');", "deny"),
    ("과외 다른 선생님 등급", "tutor1", "select public.tutor_trust_level('00000000-0000-0000-0000-000000000012');", "null"),
    ("과외 해설 직접 읽기", "tutor1", "select count(*) filter (where true) from item_explanations having count(*) > 0;", "null"),
    ("과외 정답표 직접 읽기", "tutor1", "select 1 from answer_key limit 1;", "null"),
    ("과외 학번 읽기", "tutor1", "select 1 from student_numbers limit 1;", "null"),
    ("과외 학생 메모 읽기", "tutor1", "select 1 from student_keys limit 1;", "null"),
    ("과외 구매 안 한 시험 수정요청", "tutor1", "insert into tutor_edit_requests(exam_id,item_label,tutor_id,note) values ('e0000000-0000-0000-0000-00000000000c','1',auth.uid(),'메모메모메모메모메모');", "deny"),
    ("과외 근거 없는 정답 변경 요청", "tutor1", f"insert into tutor_edit_requests(exam_id,item_label,tutor_id,proposed_answer) values ({EA},'1',auth.uid(),'2');", "deny"),
    ("과외 판정 결과 뒤집기", "tutor2", "select public.resolve_tutor_verification('70000000-0000-0000-0000-000000000001', true);", "deny"),
    ("관리자 포인트 조정(정상)", "admin", f"select public.admin_adjust_tutor_points({T1}, 1, 'ok');", "ok"),
    ("과외 구매(정상, 이미 구매)", "tutor1", f"select public.purchase_exam_download({EA});", "ok"),
    ("과외 문항 배정(정상)", "tutor1", "select public.claim_next_review_item();", "ok"),
    ("과외 자기 등급(정상)", "tutor1", f"select public.tutor_trust_level({T1});", "ok"),
]


def attacks():
    # 판정 뒤집기 시험용: tutor2의 판정 기록(일치=false)
    sh(PSQL, "insert into tutor_item_reviews(id,item_explanation_id,exam_id,item_label,tutor_id,kind,answer_display,matches_primary_review_id,is_match) "
             "select '70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b','1',"
             "'00000000-0000-0000-0000-000000000012','verify','②',id,false from tutor_item_reviews where tutor_id='00000000-0000-0000-0000-000000000011' and kind='primary' on conflict do nothing;")
    fails = 0
    for label, who, stmt, want in ATTACKS:
        lines, err = as_user(who, stmt)
        if err and "ERROR" in err:
            got = "deny"
        elif not lines:
            got = "0rows" if "returning" in stmt else "null"
        else:
            got = "ok"
        good = got == want or (want == "null" and got == "0rows") or (want == "0rows" and got == "null")
        print(("  통과 " if good else "  실패 ") + f"{label:<28} 기대 {want:<6} 실제 {got}" + ("" if good else f"  {err[:120] or lines[:1]}"))
        fails += 0 if good else 1
    return fails


build()
print("== 표 권한(역할별 읽기/고치기/지우기)")
f1 = matrix()
print("   바뀐 표 없음" if not f1 else f"   {f1}개 표가 기대와 다름")
print("== 막혀야 하는 일 / 되어야 하는 일")
f2 = attacks()
sys.exit(1 if f1 or f2 else 0)
