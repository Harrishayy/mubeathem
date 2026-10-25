import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TABS, tabById } from "@/tabs";
import { TabView } from "@/console/TabView";

// One route per tab in src/tabs.ts; anything else is a 404.
export const dynamicParams = false;
export function generateStaticParams() { return TABS.map((t) => ({ tab: t.id })); }

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const def = tabById((await params).tab);
  return def ? { title: def.label, description: def.hint } : {};
}

export default async function TabPage({ params }: Props) {
  const { tab } = await params;
  if (!tabById(tab)) notFound();
  return <TabView tab={tab} />;
}
