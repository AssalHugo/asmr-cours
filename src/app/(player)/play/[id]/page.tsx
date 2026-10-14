import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Player } from "@/components/player/player";
import { requireUser } from "@/lib/auth";
import { getCourse, listSections, listVoiceMessages } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lecture" };

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const course = await getCourse(id.data);
  if (!course) notFound();
  if (course.status !== "ready" || !course.duration_ms) redirect(`/courses/${course.id}`);

  const [sections, messages] = await Promise.all([
    listSections(course.id),
    listVoiceMessages(course.id, user.id),
  ]);
  const supabase = await createClient();
  const { data: progress } = await supabase
    .from("playback_progress")
    .select("position_ms, updated_at")
    .eq("course_id", course.id)
    .maybeSingle();

  return (
    <Player
      userId={user.id}
      course={{
        id: course.id,
        title: course.title,
        durationMs: course.duration_ms,
        ambience: course.ambience,
      }}
      chapters={sections.map((s) => ({
        title: s.title,
        startMs: s.start_ms ?? 0,
        durationMs: s.duration_ms ?? 0,
      }))}
      messages={messages
        .filter((m) => m.played_at === null)
        .map((m) => ({ id: m.id, atMs: m.at_ms, durationMs: m.duration_ms }))}
      canMark={course.user_id === user.id}
      serverPosition={
        progress
          ? { positionMs: progress.position_ms, updatedAt: Date.parse(progress.updated_at) }
          : null
      }
    />
  );
}
