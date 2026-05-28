// Derive the actual duration of a generated audio buffer.
//
// WAV/PCM containers carry exact framing, so we parse them directly. For
// compressed ElevenLabs formats (mp3) we estimate from the requested CBR
// bitrate encoded in the output-format string (e.g. "mp3_44100_128" => 128
// kbps). Returns undefined when the duration cannot be determined.

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseWavDuration(buf: Buffer): number | undefined {
  if (buf.length < 44) return undefined;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return undefined;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return undefined;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 24 <= buf.length) {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, buf.length - (offset + 8));
    }
    // Chunks are word-aligned.
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample || !dataSize) return undefined;
  return round(dataSize / (sampleRate * channels * (bitsPerSample / 8)));
}

export function measureAudioDurationSec(
  bytes: Buffer,
  options: { outputFormat?: string } = {}
): number | undefined {
  const wav = parseWavDuration(bytes);
  if (wav !== undefined) return wav;

  const fmt = (options.outputFormat || "").toLowerCase();

  const mp3 = /^mp3_\d+_(\d+)/.exec(fmt);
  if (mp3) {
    const kbps = Number(mp3[1]);
    if (kbps > 0) return round((bytes.length * 8) / (kbps * 1000));
  }

  // 16-bit mono PCM.
  const pcm = /^pcm_(\d+)/.exec(fmt);
  if (pcm) {
    const rate = Number(pcm[1]);
    if (rate > 0) return round(bytes.length / (rate * 2));
  }

  // 8-bit companded telephony formats.
  const companded = /^(?:ulaw|alaw)_(\d+)/.exec(fmt);
  if (companded) {
    const rate = Number(companded[1]);
    if (rate > 0) return round(bytes.length / rate);
  }

  return undefined;
}
