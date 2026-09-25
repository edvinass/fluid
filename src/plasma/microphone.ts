/** Loudness of the microphone input, for a globe that pulses to sound like the real thing. */
export class Microphone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private smoothed = 0;

  async start(): Promise<void> {
    if (this.context) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
    this.analyser = null;
    this.smoothed = 0;
  }

  /** Roughly 0 in a quiet room to 1 for loud music, rising quickly and falling slowly. */
  level(dt: number): number {
    if (!this.analyser || !this.samples) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    const loudness = Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
    const rate = loudness > this.smoothed ? 25 : 4;
    this.smoothed += (loudness - this.smoothed) * (1 - Math.exp(-dt * rate));
    return this.smoothed;
  }
}
