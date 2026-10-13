import { requireUser } from "@/lib/auth";

export default async function LibraryPage() {
  const user = await requireUser();
  return (
    <main className="flex-1 space-y-6 p-6">
      <h1 className="text-2xl">Bibliothèque</h1>
      <p className="text-muted-foreground">Connectée en tant que {user.email}.</p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="underline">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
