import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { BreathOrb } from "@/components/breath-orb";
import { requireUser } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-xl flex-1 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-32">
        <Suspense fallback={<Loading />}>
          <Protected>{children}</Protected>
        </Suspense>
      </div>
      <Suspense>
        <AppNav />
      </Suspense>
    </>
  );
}

async function Protected({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}

function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="Chargement"
    >
      <BreathOrb size="sm" />
    </div>
  );
}
