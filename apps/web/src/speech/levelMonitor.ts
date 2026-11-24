export interface LevelMonitor {
  /** Current mic loudness on the same 0–1 scale as dictation (RMS × 4). */
  readonly level: () => number;
  readonly close: () => void;
}

/** A light mic tap for hearing the caller talk over an agent; it records nothing. */
export async function openLevelMonitor(): Promise<LevelMonitor> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation keeps the agent's own voice out where the device supports it.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    level: () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
    close: () => {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
