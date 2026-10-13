/** Une allowlist vide n'autorise personne : l'app est privée par défaut. */
export function isAllowedEmail(email: string | null | undefined, allowed: readonly string[]) {
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
