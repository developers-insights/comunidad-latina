import { redirect } from "next/navigation";

/** /admin → la cola de moderación es el home natural de todo el staff. */
export default function AdminIndexPage() {
  redirect("/admin/moderacion");
}
