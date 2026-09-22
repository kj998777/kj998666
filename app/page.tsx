import { redirect } from "next/navigation";
import { getSessionAndRole } from "@/lib/auth/requireRole";

export default async function HomePage() {
  const session = await getSessionAndRole();
  redirect(session ? "/dashboard" : "/login");
}
