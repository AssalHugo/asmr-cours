import { Suspense } from "react";
import { requireUser } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <Protected>{children}</Protected>
    </Suspense>
  );
}

async function Protected({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
