import { describe, expect, it } from "vitest";
import {
  driveConfig,
  driveDownload,
  DrivePick,
  DrivePickerResult,
  drivePickerMimeTypes,
} from "@/lib/drive";

describe("import Google Drive", () => {
  it("n'est configuré qu'avec le client OAuth et la clé, et en déduit le numéro de projet", () => {
    expect(driveConfig({})).toBeNull();
    expect(
      driveConfig({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "1234-abc.apps.googleusercontent.com" }),
    ).toBeNull();
    expect(
      driveConfig({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "abc", NEXT_PUBLIC_GOOGLE_API_KEY: "k" }),
    ).toBeNull();
    expect(
      driveConfig({
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: "1234-abc.apps.googleusercontent.com",
        NEXT_PUBLIC_GOOGLE_API_KEY: "k",
      }),
    ).toEqual({ clientId: "1234-abc.apps.googleusercontent.com", apiKey: "k", appId: "1234" });
  });

  it("propose les documents Google avec les PDF, pas avec les photos", () => {
    expect(drivePickerMimeTypes("pdf")).toEqual([
      "application/pdf",
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.presentation",
    ]);
    expect(drivePickerMimeTypes("images")).toContain("image/heic");
    expect(drivePickerMimeTypes("images").join()).not.toMatch(/google-apps/);
  });

  it("télécharge un fichier tel quel et convertit un Google Docs en PDF", () => {
    const pdf = DrivePick.parse({ id: "a/b", name: "Cours.pdf", mimeType: "application/pdf" });
    expect(driveDownload("pdf", pdf)).toEqual({
      url: "https://www.googleapis.com/drive/v3/files/a%2Fb?alt=media",
      type: "application/pdf",
      name: "Cours.pdf",
    });
    const doc = DrivePick.parse({
      id: "xyz",
      name: "Histoire - chapitre 2",
      mimeType: "application/vnd.google-apps.document",
    });
    expect(driveDownload("pdf", doc)).toEqual({
      url: "https://www.googleapis.com/drive/v3/files/xyz/export?mimeType=application%2Fpdf",
      type: "application/pdf",
      name: "Histoire - chapitre 2.pdf",
    });
    const docWithPdf = DrivePick.parse({
      id: "xyz",
      name: "Histoire.pdf",
      mimeType: "application/vnd.google-apps.document",
    });
    expect(driveDownload("pdf", docWithPdf)?.name).toBe("Histoire.pdf");
    expect(driveDownload("images", doc)).toBeNull();
  });

  it("refuse un type qui ne correspond pas à l'onglet", () => {
    const photo = DrivePick.parse({ id: "p", name: "IMG_1.JPG", mimeType: "IMAGE/JPEG" });
    expect(driveDownload("images", photo)?.type).toBe("image/jpeg");
    expect(driveDownload("pdf", photo)).toBeNull();
    const sheet = DrivePick.parse({
      id: "s",
      name: "Notes",
      mimeType: "application/vnd.google-apps.spreadsheet",
    });
    expect(driveDownload("pdf", sheet)).toBeNull();
  });

  it("borne le nom et tolère les champs absents du sélecteur", () => {
    const doc = DrivePick.parse({ id: "d", mimeType: "application/vnd.google-apps.document" });
    expect(doc.sizeBytes).toBeUndefined();
    expect(driveDownload("pdf", doc)?.name).toBe("Sans titre.pdf");
    const long = DrivePick.parse({
      id: "l",
      name: "x".repeat(300),
      mimeType: "application/vnd.google-apps.document",
      sizeBytes: "12",
    });
    expect(long.sizeBytes).toBe(12);
    expect(driveDownload("pdf", long)?.name.length).toBeLessThanOrEqual(200);
    expect(DrivePickerResult.parse({ action: "cancel" }).docs).toBeUndefined();
  });
});
