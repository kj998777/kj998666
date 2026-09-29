import { redirect } from "next/navigation";
import { getSessionAndRole } from "@/lib/auth/requireRole";
import SignOutButton from "../(staff)/SignOutButton";
import RefreshButton from "./RefreshButton";

// #6: 자율 가입(회원가입) 계정의 기본 역할 '대기'가 도착하는 화면. 관리자가 계정 관리 화면에서
// 알맞은 권한으로 바꿔줄 때까지는 아무 것도 할 수 없고, 이 안내와 로그아웃 버튼만 볼 수 있다.
// admin/editor/viewer/tutor 계정이 실수로 여기 들어오면 각자의 홈으로 돌려보낸다.
export default async function PendingPage() {
  const session = await getSessionAndRole();
  if (!session) redirect("/login");
  if (session.role === "tutor") redirect("/tutor/dashboard");
  if (session.role === "admin" || session.role === "editor" || session.role === "viewer") redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="card w-full max-w-sm text-center space-y-3">
        <h1 className="text-lg font-semibold">대기중인 계정입니다</h1>
        <p className="text-sm text-slate-500">
          아직 이 계정에는 사용 권한이 지정되지 않았습니다. 관리자가 권한(뷰어·편집자·관리자·과외선생님)을
          지정해 줄 때까지 기다려 주세요.
        </p>
        <p className="text-xs text-slate-400">{session.email}</p>
        <p className="text-xs text-slate-500">권한을 받은 뒤 새로고침을 누르면 바로 들어갈 수 있습니다.</p>
        <div className="flex justify-center gap-2">
          <RefreshButton />
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
