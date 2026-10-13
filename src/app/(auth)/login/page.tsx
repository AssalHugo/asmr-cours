import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl">Murmure</h1>
          <p className="text-muted-foreground">Tes cours, chuchotés.</p>
        </div>
        <Suspense fallback={<div className="h-40" aria-busy="true" />}>
          <LoginFormWithError searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginFormWithError({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { erreur } = await searchParams;
  return <LoginForm linkError={erreur === "lien"} />;
}
