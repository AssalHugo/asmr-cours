import { requireUser } from "@/lib/auth";

/** Le lecteur occupe tout l'écran : pas de navigation basse, rien qui distraie. */
export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
