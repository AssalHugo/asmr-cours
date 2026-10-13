import { expect, test, type Page } from "@playwright/test";

const COURSE_TEXT = [
  "La photosynthèse transforme l'énergie lumineuse en énergie chimique. Elle a lieu dans les chloroplastes. Elle consomme de l'eau et du dioxyde de carbone. Elle produit du glucose et du dioxygène.",
  "La respiration cellulaire fait l'inverse. Elle dégrade le glucose pour libérer de l'énergie. Elle se déroule dans les mitochondries. Elle rejette du dioxyde de carbone et de l'eau.",
].join("\n\n");

test.describe.configure({ mode: "serial" });

let courseUrl = "";

const position = (page: Page) =>
  page.getByRole("slider", { name: "Position dans la piste" }).getAttribute("aria-valuetext");

async function canPlayAac(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "",
  );
}

test("refuse poliment une adresse non invitée, et protège l'app sans session", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Ton email").fill("inconnue@exemple.fr");
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByText("Murmure est un espace privé")).toBeVisible();
  await context.close();
});

test("crée un cours depuis un texte collé et suit sa génération jusqu'au bout", async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Rien à écouter pour l'instant" })).toBeVisible();
  await page.getByRole("link", { name: "Créer un cours" }).click();

  // Étape 1 : source.
  await page.getByText("Texte", { exact: true }).click();
  await page.getByLabel("Texte du cours").fill(COURSE_TEXT);
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 2 : réglages.
  const title = page.getByLabel("Titre");
  await expect(title).toHaveValue(/photosynthèse/);
  await title.fill("Photosynthèse et respiration");
  await page.getByText("Bruit rose", { exact: true }).click();
  await page.getByRole("button", { name: "Voir l'estimation" }).click();

  // Étape 3 : estimation des 4 combinaisons, budget, lancement.
  await expect(page.getByText("Durée estimée")).toBeVisible();
  await expect(page.getByText(/^(Éco|Express) · (Standard|Économie)$/)).toHaveCount(4);
  await expect(page.getByText("Budget restant ce mois-ci")).toBeVisible();
  await page.getByText("Express · Standard", { exact: true }).click();
  await page.getByRole("button", { name: "Générer" }).click();

  // Progression, puis cours prêt.
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]{36}$/);
  courseUrl = new URL(page.url()).pathname;
  await expect(
    page.getByRole("link", { name: "Écouter Photosynthèse et respiration" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Chapitres" })).toBeVisible();
  await expect(page.getByText("Fidèle").first()).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Photosynthèse et respiration" })).toBeVisible();
});

test("lit le cours : lecture, texte, changement d'ambiance, minuteur", async ({ page }) => {
  await page.goto(courseUrl.replace("/courses/", "/play/"));
  test.skip(
    !(await canPlayAac(page)),
    "Ce navigateur ne décode pas l'AAC (Chromium de test sans codecs).",
  );

  await page.getByRole("button", { name: "Lire" }).click();
  await expect(page.getByRole("button", { name: "Mettre en pause" })).toBeVisible();
  await expect.poll(() => position(page), { timeout: 20_000 }).not.toBe("0:00");

  // Afficher le texte : le sous-titre du passage en cours.
  await page.getByRole("button", { name: "Afficher le texte" }).click();
  await expect(page.getByText("La photosynthèse transforme l'énergie lumineuse")).toBeVisible();

  // Changement d'ambiance à chaud : le nouveau fichier est chargé, la lecture continue.
  const ambience = page.waitForResponse(
    (r) => r.url().includes("/ambience/fireplace") && r.status() < 400,
  );
  await page.getByRole("button", { name: "Mix et ambiance" }).click();
  await page.getByText("Cheminée", { exact: true }).click();
  await ambience;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Mettre en pause" })).toBeVisible();

  // Minuteur de sommeil.
  await page.getByRole("button", { name: "Minuteur de sommeil" }).click();
  await page.getByRole("button", { name: "15 min" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "Arrêt dans" })).toContainText(/14:5\d/);

  // Avance de 15 s, pause, et position mémorisée pour la reprise.
  const before = await position(page);
  await page.getByRole("button", { name: "Avancer de 15 secondes" }).click();
  await expect.poll(() => position(page)).not.toBe(before);
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(page.getByRole("button", { name: "Lire" })).toBeVisible();
  const saved = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("murmure-position-"))
      .map((k) => localStorage.getItem(k)),
  );
  expect(saved.join()).toMatch(/"positionMs":\d{4,}/);
});

test("télécharge le cours et le lit sans réseau", async ({ page, context }) => {
  await page.goto(courseUrl);
  // Le service worker doit contrôler la page avant de couper le réseau.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await page.getByRole("button", { name: "Télécharger" }).click();
  await expect(page.getByRole("button", { name: "Retirer de l'appareil" })).toBeVisible({
    timeout: 30_000,
  });

  await context.setOffline(true);

  // Une plage demandée hors-ligne est servie depuis la réponse complète du cache.
  const range = await page.evaluate(async (path) => {
    const id = path.split("/").pop();
    const res = await fetch(`/api/audio/${id}/voice.m4a`, { headers: { Range: "bytes=0-99" } });
    return {
      status: res.status,
      contentRange: res.headers.get("content-range"),
      bytes: (await res.arrayBuffer()).byteLength,
    };
  }, courseUrl);
  expect(range.status).toBe(206);
  expect(range.contentRange).toMatch(/^bytes 0-99\/\d+$/);
  expect(range.bytes).toBe(100);

  // Page de repli hors-ligne : elle mène au cours téléchargé.
  // (`page.goto` ne navigue pas quand Playwright simule l'absence de réseau.)
  await page.evaluate(() => location.assign("/settings"));
  await expect(page.getByRole("heading", { name: "Tu es hors-ligne" })).toBeVisible();
  await page.getByRole("link", { name: "Photosynthèse et respiration" }).click();
  await expect(page.getByRole("button", { name: "Lire" })).toBeVisible();

  if (await canPlayAac(page)) {
    await page.getByRole("button", { name: "Lire" }).click();
    await expect.poll(() => position(page), { timeout: 20_000 }).not.toBe("0:00");
  }
  await context.setOffline(false);
});

test("refait le pré-mix avec une autre ambiance, puis supprime le cours", async ({ page }) => {
  await page.goto(courseUrl);
  await page.getByRole("button", { name: "Changer l'ambiance du pré-mix" }).click();
  await page.getByRole("dialog").getByText("Pluie", { exact: true }).click();
  await page.getByRole("button", { name: "Refaire le pré-mix" }).click();
  await expect(page.getByRole("link", { name: /^Écouter/ })).toBeVisible({ timeout: 60_000 });
  const mix = await page.request.get(
    `${courseUrl.replace("/courses/", "/api/audio/")}/mix-rain.m4a`,
  );
  expect(mix.status()).toBe(200);

  await page.getByRole("button", { name: "Supprimer ce cours" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Rien à écouter pour l'instant" })).toBeVisible();
});
