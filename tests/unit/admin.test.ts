import { describe, expect, it } from "vitest";
import { fillMonths, monthStart } from "@/lib/admin";

describe("mode admin", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("complète les mois sans dépense jusqu'au mois en cours", () => {
    const months = fillMonths([{ month: "2026-09-01", costUsd: 2.5 }], 3, now);
    expect(months).toEqual([
      { month: "2026-08-01", costUsd: 0 },
      { month: "2026-09-01", costUsd: 2.5 },
      { month: "2026-10-01", costUsd: 0 },
    ]);
  });

  it("passe d'une année à l'autre", () => {
    const months = fillMonths([], 12, now);
    expect(months[0]?.month).toBe("2025-11-01");
    expect(months.at(-1)?.month).toBe("2026-10-01");
  });

  it("calcule le début du mois en UTC", () => {
    expect(monthStart(now)).toBe("2026-10-01T00:00:00.000Z");
  });
});
