import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AIMetricsDashboard } from "@/components/AIMetricsDashboard";

export const dynamic = "force-dynamic";

export default async function AIMetricsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/admin/ai-metrics");
  }

  return (
    <div className="mx-auto max-w-4xl py-8">
      <AIMetricsDashboard />
    </div>
  );
}
