import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { Sidebar } from "@/components/Sidebar";
import { listSessions } from "@/lib/appdb";
import { listDashboards, listDashboardNames, buildItemOutput } from "@/lib/dashboards";
import { listAllSources } from "@/lib/sources";
import { DashboardView, type DashCard, type DashGroup, type AvailableTable } from "@/components/DashboardView";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return <LoginForm />;

  const only = (await searchParams).only;

  const [allDashboards, sources, sessions, dashboardNames] = await Promise.all([
    listDashboards(user.userId),
    listAllSources(),
    listSessions(user.userId),
    listDashboardNames(user.userId),
  ]);
  // When one dashboard is focused (from the sidebar), show only that one.
  const dashboards = only ? allDashboards.filter((d) => d.name === only) : allDashboards;

  // Re-run every saved chart's query so the dashboard shows live data.
  const groups: DashGroup[] = await Promise.all(
    dashboards.map(async (d) => ({
      name: d.name,
      cards: await Promise.all(
        d.items.map(
          async (it): Promise<DashCard> => ({
            item_id: it.item_id,
            title: it.title,
            output: await buildItemOutput(it.spec),
            origin: it.source?.origin ?? null,
            lastRefreshed: it.source?.last_refreshed_at ?? null,
          })
        )
      ),
    }))
  );

  const available: AvailableTable[] = sources.map((s) => ({
    table_name: s.table_name,
    origin: s.origin,
  }));
  const existingNames = allDashboards.map((d) => d.name);

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense>
        <Sidebar user={user} sessions={sessions} dashboards={dashboardNames} />
      </Suspense>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <DashboardView
          groups={groups}
          available={available}
          existingNames={existingNames}
          focused={only ?? null}
        />
      </div>
    </div>
  );
}
