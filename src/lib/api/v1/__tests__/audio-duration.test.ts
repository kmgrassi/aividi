import assert from "node:assert/strict";
import test from "node:test";
import { measureAudioDurationSec } from "../audio-duration";

function buildWav(seconds: number, sampleRate = 8000): Buffer {
  const dataSize = Math.round(seconds * sampleRate) * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test("measures WAV duration exactly from framing", () => {
  assert.equal(measureAudioDurationSec(buildWav(3)), 3);
  assert.equal(measureAudioDurationSec(buildWav(0.5, 44100)), 0.5);
});

test("estimates mp3 duration from CBR output format", () => {
  // 16000 bytes at 128 kbps == exactly 1 second.
  const bytes = Buffer.alloc(16000);
  assert.equal(
    measureAudioDurationSec(bytes, { outputFormat: "mp3_44100_128" }),
    1
  );
});

test("estimates pcm duration from output format", () => {
  const bytes = Buffer.alloc(16000 * 2); // 16-bit mono @ 16kHz for 1s
  assert.equal(
    measureAudioDurationSec(bytes, { outputFormat: "pcm_16000" }),
    1
  );
});

test("returns undefined when duration cannot be determined", () => {
  assert.equal(measureAudioDurationSec(Buffer.from("not audio")), undefined);
  assert.equal(
    measureAudioDurationSec(Buffer.alloc(1000), { outputFormat: "opus_48000" }),
    undefined
  );
});
