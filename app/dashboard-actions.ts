"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { addChart, addTable, removeItem } from "@/lib/dashboards";
import type { RenderInput } from "@/lib/spec";

/** Save a chart straight from the chat (the rendered component's spec). */
export async function addChartToDashboard(dashboard: string, specJson: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  let spec: RenderInput;
  try {
    spec = JSON.parse(specJson) as RenderInput;
  } catch {
    throw new Error("Invalid chart spec.");
  }
  await addChart(user.userId, dashboard, spec);
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/** Add a raw table (from the dashboard picker) as a table-preview chart. */
export async function addTableToDashboard(dashboard: string, tableName: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  await addTable(user.userId, dashboard, tableName);
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/** Add several raw tables to one dashboard in a single go. */
export async function addTablesToDashboard(dashboard: string, tableNames: string[]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  for (const t of tableNames) {
    await addTable(user.userId, dashboard, t);
  }
  revalidatePath("/dashboard");
  revalidatePath("/");
}

export async function removeItemFromDashboard(dashboard: string, itemId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  await removeItem(user.userId, dashboard, itemId);
  revalidatePath("/dashboard");
  revalidatePath("/");
}
