import { redirect } from "next/navigation";
import { TABS } from "@/tabs";

export default function Home() {
  redirect(`/${TABS[0].id}`);
}
