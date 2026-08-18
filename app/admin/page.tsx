import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = { title: "Administration" };

export default function Page() {
  return <AdminPage />;
}
