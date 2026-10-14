"use client";

import {
  Check,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createFolder, deleteFolder, moveCourse, renameFolder } from "@/app/(app)/library/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/course-input";

export type FolderOption = { id: string; name: string };

const NAME_MAX = 60;

/** Lance une action de dossier : message d'erreur en toast, sinon suite puis rechargement. */
function useFolderAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function act(
    action: () => Promise<ActionResult<{ folderId: string }> | ActionResult>,
    done: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      done();
      router.refresh();
    });
  }
  return { pending, act, router };
}

function NameForm({
  id,
  label,
  submit,
  initial = "",
  pending,
  onSubmit,
}: {
  id: string;
  label: string;
  submit: string;
  initial?: string;
  pending: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
    >
      <label htmlFor={id} className="text-muted-foreground block text-sm">
        {label}
      </label>
      <Input
        id={id}
        required
        maxLength={NAME_MAX}
        autoComplete="off"
        placeholder="Biologie, Partiels de juin…"
        className="h-11"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" className="w-full" disabled={pending || name.trim() === ""}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {submit}
      </Button>
    </form>
  );
}

export function NewFolderButton() {
  const [open, setOpen] = useState(false);
  const { pending, act, router } = useFolderAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0">
          <FolderPlus aria-hidden />
          Nouveau dossier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dossier</DialogTitle>
          <DialogDescription>
            Range ensuite tes cours dedans depuis leur carte, dans la bibliothèque.
          </DialogDescription>
        </DialogHeader>
        <NameForm
          id="new-folder-name"
          label="Nom du dossier"
          submit="Créer"
          pending={pending}
          onSubmit={(name) => {
            let created = "";
            act(
              async () => {
                const result = await createFolder({ name });
                if (result.ok) created = result.data.folderId;
                return result;
              },
              () => {
                setOpen(false);
                router.push(`/library?folder=${created}`);
              },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Renommer ou supprimer le dossier affiché. */
export function FolderActions({ folder }: { folder: FolderOption }) {
  const [renaming, setRenaming] = useState(false);
  const { pending, act, router } = useFolderAction();
  return (
    <div className="-ml-4 flex flex-wrap gap-1">
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending}>
            <Pencil aria-hidden />
            Renommer
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer le dossier</DialogTitle>
            <DialogDescription>Les cours qu&apos;il contient ne bougent pas.</DialogDescription>
          </DialogHeader>
          <NameForm
            key={folder.name}
            id={`rename-folder-${folder.id}`}
            label="Nom du dossier"
            submit="Renommer"
            initial={folder.name}
            pending={pending}
            onSubmit={(name) =>
              act(
                () => renameFolder({ folderId: folder.id, name }),
                () => setRenaming(false),
              )
            }
          />
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={pending}>
            <Trash2 aria-hidden />
            Supprimer le dossier
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {folder.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Seul le dossier disparaît. Ses cours restent dans ta bibliothèque, sans dossier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                act(
                  () => deleteFolder(folder.id),
                  () => {
                    toast.success("Dossier supprimé.");
                    router.push("/library");
                  },
                )
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Range un cours dans un dossier, existant ou créé sur place. */
export function MoveToFolder({
  courseId,
  courseTitle,
  folders,
  folderId,
  compact = false,
}: {
  courseId: string;
  courseTitle: string;
  folders: FolderOption[];
  /** Dossier actuel du cours pour ce compte, `null` s'il n'est rangé nulle part. */
  folderId: string | null;
  /** Bouton réduit à son icône, pour les cartes de la bibliothèque. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, act } = useFolderAction();
  const current = folders.find((f) => f.id === folderId) ?? null;

  function move(target: FolderOption | null) {
    if ((target?.id ?? null) === (current?.id ?? null)) {
      setOpen(false);
      return;
    }
    act(
      () => moveCourse({ courseId, folderId: target?.id ?? null }),
      () => {
        toast.success(target ? `Rangé dans « ${target.name} ».` : "Sorti du dossier.");
        setOpen(false);
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-11"
            aria-label={`Ranger « ${courseTitle} » dans un dossier`}
          >
            <FolderInput aria-hidden />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <FolderInput aria-hidden />
            {current ? current.name : "Ranger dans un dossier"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ranger ce cours</DialogTitle>
          <DialogDescription>« {courseTitle} »</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {folders.length > 0 ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {[...folders, null].map((folder) => {
                const selected = (folder?.id ?? null) === (current?.id ?? null);
                return (
                  <li key={folder?.id ?? "none"}>
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={selected}
                      onClick={() => move(folder)}
                      className="hover:bg-muted flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-base disabled:opacity-50"
                    >
                      {folder ? (
                        <FolderIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
                      ) : (
                        <span className="size-5 shrink-0" />
                      )}
                      <span className={folder ? "truncate" : "text-muted-foreground"}>
                        {folder ? folder.name : "Aucun dossier"}
                      </span>
                      {selected ? (
                        <Check className="text-sand ml-auto size-5 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <NameForm
            id={`move-new-folder-${courseId}`}
            label="Nouveau dossier"
            submit="Créer et ranger"
            pending={pending}
            onSubmit={(name) =>
              act(
                () => createFolder({ name, courseId }),
                () => {
                  toast.success(`Rangé dans « ${name.trim()} ».`);
                  setOpen(false);
                },
              )
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
