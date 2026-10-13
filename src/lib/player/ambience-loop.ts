import { equalPowerCurves } from "./timeline";

const CROSSFADE_SECONDS = 3;
const LOOKAHEAD_SECONDS = 1.5;

/**
 * Boucle d'ambiance sans blanc au raccord : deux sources alternées qui se recouvrent
 * par un crossfade equal-power de 3 s. (`<audio loop>` laisse un silence à chaque tour.)
 */
export class AmbienceLoop {
  private readonly out: GainNode;
  private readonly overlap: number;
  private readonly curves = equalPowerCurves();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextStart = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.overlap = Math.min(CROSSFADE_SECONDS, buffer.duration / 4);
  }

  /** Démarre la boucle, avec un fondu d'entrée (2 s lors d'un changement d'ambiance à chaud). */
  start(fadeInSeconds: number): void {
    const now = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + Math.max(0.05, fadeInSeconds));
    this.schedule(now, false);
    this.timer = setInterval(() => this.tick(), 400);
  }

  private tick(): void {
    if (this.nextStart - this.ctx.currentTime < LOOKAHEAD_SECONDS) {
      this.schedule(Math.max(this.nextStart, this.ctx.currentTime), true);
    }
  }

  private schedule(at: number, fadeIn: boolean): void {
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = this.buffer;
    source.connect(gain);
    gain.connect(this.out);

    const end = at + this.buffer.duration;
    if (fadeIn) gain.gain.setValueCurveAtTime(this.curves.fadeIn, at, this.overlap);
    else gain.gain.setValueAtTime(1, at);
    gain.gain.setValueCurveAtTime(this.curves.fadeOut, end - this.overlap, this.overlap);

    source.start(at);
    source.stop(end + 0.05);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    this.nextStart = end - this.overlap;
  }

  /** Arrête la boucle après un fondu de sortie. */
  stop(fadeOutSeconds: number): void {
    clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fadeOutSeconds));
    setTimeout(
      () => {
        for (const source of this.sources) {
          try {
            source.stop();
          } catch {
            // Source déjà arrêtée.
          }
        }
        this.out.disconnect();
      },
      fadeOutSeconds * 1000 + 150,
    );
  }
}
