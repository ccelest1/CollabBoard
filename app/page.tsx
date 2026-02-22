import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HomeLandingClient } from "@/components/landing/HomeLandingClient";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return <HomeLandingClient />;
}
