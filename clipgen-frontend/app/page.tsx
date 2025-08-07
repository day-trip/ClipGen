import {redirectIfAuthenticated} from "@/app/lib/auth-check";
import {redirect} from "next/navigation";

export default async function Home() {
  await redirectIfAuthenticated();
  redirect("/auth/signin");
}
