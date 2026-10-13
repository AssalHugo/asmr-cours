import { UploadError } from "@/components/upload/upload-files";
import {
  DRIVE_SCOPE,
  driveDownload,
  drivePickerMimeTypes,
  DrivePickerResult,
  type DriveConfig,
  type DriveDownload,
  type DriveKind,
} from "@/lib/drive";

const GAPI_SRC = "https://apis.google.com/js/api.js";
const GIS_SRC = "https://accounts.google.com/gsi/client";

// Sous-ensemble des API Google chargées par script : seulement ce que ce module appelle.
type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string };
type TokenClient = { requestAccessToken: () => void };
type PickerView = {
  setMimeTypes: (types: string) => PickerView;
  setIncludeFolders: (include: boolean) => PickerView;
  setMode: (mode: unknown) => PickerView;
};
type PickerBuilder = {
  addView: (view: PickerView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setLocale: (locale: string) => PickerBuilder;
  setMaxItems: (max: number) => PickerBuilder;
  enableFeature: (feature: unknown) => PickerBuilder;
  setCallback: (callback: (data: unknown) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type GoogleApis = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: (error: { type?: string }) => void;
      }) => TokenClient;
    };
  };
  picker: {
    DocsView: new () => PickerView;
    PickerBuilder: new () => PickerBuilder;
    DocsViewMode: { LIST: unknown };
    Feature: { MULTISELECT_ENABLED: unknown };
  };
};
type Gapi = {
  load: (
    name: string,
    options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void },
  ) => void;
};

declare global {
  interface Window {
    gapi?: Gapi;
    google?: GoogleApis;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new UploadError("Google Drive est injoignable. Vérifie ta connexion et réessaie."));
    };
    document.head.append(script);
  });
}

let ready: Promise<GoogleApis> | undefined;

/**
 * Charge les scripts Google. À appeler dès l'affichage du bouton : la fenêtre de connexion
 * doit s'ouvrir dans la foulée du clic, sans attente réseau, sinon le navigateur la bloque.
 */
export function preloadDrive(): Promise<GoogleApis> {
  ready ??= (async () => {
    await Promise.all([loadScript(GAPI_SRC), loadScript(GIS_SRC)]);
    const failed = new UploadError("Le sélecteur Google Drive n'a pas pu se charger.");
    await new Promise<void>((resolve, reject) => {
      if (!window.gapi) return reject(failed);
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(failed),
        timeout: 10_000,
        ontimeout: () => reject(failed),
      });
    });
    if (!window.google?.picker || !window.google.accounts) throw failed;
    return window.google;
  })();
  // Un échec ne condamne pas le bouton : le prochain clic retente le chargement.
  ready.catch(() => {
    ready = undefined;
  });
  return ready;
}

let token: { value: string; expiresAt: number } | undefined;

/** Jeton d'accès Drive, ou `null` si la personne ferme la fenêtre ou refuse. */
function requestToken(google: GoogleApis, clientId: string): Promise<string | null> {
  if (token && token.expiresAt > Date.now()) return Promise.resolve(token.value);
  return new Promise((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (!response.access_token) return resolve(null);
          const seconds = Number(response.expires_in) || 3600;
          token = { value: response.access_token, expiresAt: Date.now() + (seconds - 60) * 1000 };
          resolve(response.access_token);
        },
        error_callback: (error) => {
          if (error.type === "popup_closed") return resolve(null);
          reject(
            new UploadError(
              error.type === "popup_failed_to_open"
                ? "La fenêtre de connexion Google a été bloquée. Autorise les pop-ups pour ce site et réessaie."
                : "La connexion à Google Drive a échoué.",
            ),
          );
        },
      })
      .requestAccessToken();
  });
}

/** Affiche le sélecteur et attend le choix ou l'annulation. */
function showPicker(
  google: GoogleApis,
  config: DriveConfig,
  accessToken: string,
  kind: DriveKind,
  maxFiles: number,
): Promise<DrivePickerResult> {
  return new Promise((resolve, reject) => {
    const onEvent = (data: unknown) => {
      const result = DrivePickerResult.safeParse(data);
      if (!result.success) return reject(new UploadError("Réponse inattendue de Google Drive."));
      // Le sélecteur rappelle aussi à son ouverture (« loaded ») : attendre la suite.
      if (result.data.action === "picked" || result.data.action === "cancel") resolve(result.data);
    };
    const view = new google.picker.DocsView()
      .setMimeTypes(drivePickerMimeTypes(kind).join(","))
      .setIncludeFolders(true)
      .setMode(google.picker.DocsViewMode.LIST);
    let builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setLocale("fr")
      .setCallback(onEvent);
    if (maxFiles > 1) {
      builder = builder
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setMaxItems(maxFiles);
    }
    builder.build().setVisible(true);
  });
}

async function download(target: DriveDownload, accessToken: string, signal?: AbortSignal) {
  const failed = new UploadError(`« ${target.name} » n'a pas pu être récupéré depuis Drive.`);
  const res = await fetch(target.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  }).catch(() => {
    throw failed;
  });
  if (res.status === 401) token = undefined;
  if (!res.ok) {
    const reason = await res.text().catch(() => "");
    throw reason.includes("exportSizeLimitExceeded")
      ? new UploadError(
          `« ${target.name} » est trop volumineux pour être converti. Télécharge-le en PDF depuis Google Docs, puis dépose le fichier.`,
        )
      : failed;
  }
  return new File([await res.blob()], target.name, { type: target.type });
}

/**
 * Ouvre le sélecteur Google Drive et rapatrie les fichiers choisis dans le navigateur,
 * prêts pour `uploadFiles`. Renvoie `null` si la personne annule.
 */
export async function pickFromDrive(
  config: DriveConfig,
  kind: DriveKind,
  limits: { maxFiles: number; maxBytes: number },
  onProgress: (ratio: number | null) => void,
  signal?: AbortSignal,
): Promise<File[] | null> {
  const google = await preloadDrive();
  const accessToken = await requestToken(google, config.clientId);
  if (!accessToken) return null;

  const picked = await showPicker(google, config, accessToken, kind, limits.maxFiles);
  const picks = picked.docs ?? [];
  if (picked.action !== "picked" || picks.length === 0) return null;

  const targets = picks.map((pick) => {
    const target = driveDownload(kind, pick);
    if (!target) {
      throw new UploadError(
        kind === "pdf"
          ? `« ${pick.name} » n'est ni un PDF, ni un Google Docs, ni un Google Slides.`
          : `« ${pick.name} » n'est pas une image prise en charge (JPG, PNG, WEBP ou HEIC).`,
      );
    }
    // Inutile de rapatrier un fichier que le dépôt refusera.
    if ((pick.sizeBytes ?? 0) > limits.maxBytes) {
      throw new UploadError(
        `« ${pick.name} » est trop lourd : ${Math.floor(limits.maxBytes / 1024 / 1024)} Mo maximum.`,
      );
    }
    return target;
  });

  const files: File[] = [];
  onProgress(targets.length > 1 ? 0 : null);
  for (const target of targets) {
    files.push(await download(target, accessToken, signal));
    if (targets.length > 1) onProgress(files.length / targets.length);
  }
  return files;
}
