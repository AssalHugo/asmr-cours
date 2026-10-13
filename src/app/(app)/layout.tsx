import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { requireUser } from "@/lib/auth";
import Loading from "./loading";

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
