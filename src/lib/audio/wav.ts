/** Lecture et écriture de WAV PCM, sans dépendance (cache TTS, mock, mesure des durées). */

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  durationMs: number;
};

export function parseWav(buffer: Buffer): WavInfo {
  if (
    buffer.length < 12 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Fichier WAV invalide (en-tête RIFF/WAVE absent)");
  }
  let offset = 12;
  let format: { sampleRate: number; channels: number; bitsPerSample: number } | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!format) throw new Error("Fichier WAV invalide (bloc fmt absent)");
      // Certains encodeurs en flux écrivent une taille nulle ou 0xFFFFFFFF : on prend le reste.
      const dataBytes = Math.min(
        size === 0 || size === 0xffffffff ? Infinity : size,
        buffer.length - body,
      );
      const bytesPerSecond = (format.sampleRate * format.channels * format.bitsPerSample) / 8;
      return {
        ...format,
        dataOffset: body,
        dataBytes,
        durationMs: Math.round((dataBytes / bytesPerSecond) * 1000),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("Fichier WAV invalide (bloc data absent)");
}

/** Enveloppe du PCM 16 bits little-endian dans un conteneur WAV. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Sinusoïde douce avec fondus, pour le TTS mock et les fixtures de test. */
export function sineWav(
  durationMs: number,
  opts: { frequency?: number; sampleRate?: number; gain?: number } = {},
): Buffer {
  const sampleRate = opts.sampleRate ?? 24_000;
  const frequency = opts.frequency ?? 220;
  const gain = opts.gain ?? 0.12;
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const fade = Math.min(Math.round(sampleRate * 0.05), Math.floor(samples / 2));
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const envelope = fade === 0 ? 1 : Math.min(1, i / fade, (samples - 1 - i) / fade);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * gain * envelope;
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm16ToWav(pcm, sampleRate);
}
