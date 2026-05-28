import { promises as fs } from "fs";
import path from "path";
import {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
  GenerativeProviderName,
} from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Prompt is required.");
  return trimmed;
}

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

async function readAsBlob(filePath: string): Promise<Blob> {
  const bytes = await fs.readFile(filePath);
  return new Blob([new Uint8Array(bytes)], { type: mimeForPath(filePath) });
}

async function openaiFetch(
  pathName: string,
  init: RequestInit
): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set for the OpenAI provider.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);

  const res = await fetch(`${OPENAI_BASE_URL}${pathName}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res;
}

async function generateOpenAIImage(
  input: GenerateAssetRequest
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const model = input.model || "gpt-image-2";
  const referencePaths = input.referencePaths || [];

  if (referencePaths.length > 0) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    if (input.size) form.set("size", input.size);
    if (input.quality) form.set("quality", input.quality);
    for (const filePath of referencePaths) {
      form.append("image[]", await readAsBlob(filePath), path.basename(filePath));
    }

    const res = await openaiFetch("/images/edits", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image edit returned no image data.");
    return {
      kind: "image",
      bytes: Buffer.from(b64, "base64"),
      extension: "png",
      mimeType: "image/png",
      provider: "openai",
      model,
      prompt,
    };
  }

  const res = await openaiFetch("/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      ...(input.size ? { size: input.size } : {}),
      ...(input.quality ? { quality: input.quality } : {}),
    }),
  });
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image generation returned no image data.");
  return {
    kind: "image",
    bytes: Buffer.from(b64, "base64"),
    extension: "png",
    mimeType: "image/png",
    provider: "openai",
    model,
    prompt,
  };
}

async function generateOpenAIVideo(
  input: GenerateAssetRequest
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const model = input.model || "sora-2";
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", input.size || "1280x720");
  form.set("seconds", String(input.seconds || 8));

  const firstReference = input.referencePaths?.[0];
  if (firstReference) {
    form.set(
      "input_reference",
      await readAsBlob(firstReference),
      path.basename(firstReference)
    );
  }

  const createRes = await openaiFetch("/videos", {
    method: "POST",
    body: form,
  });
  let video = await createRes.json();
  const id = video?.id;
  if (!id) throw new Error("OpenAI video generation returned no job id.");

  const deadline = Date.now() + 8 * 60 * 1000;
  while (
    (video.status === "queued" || video.status === "in_progress") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusRes = await openaiFetch(`/videos/${id}`, { method: "GET" });
    video = await statusRes.json();
  }

  if (video.status !== "completed") {
    throw new Error(`OpenAI video generation did not complete: ${video.status}`);
  }

  const contentRes = await openaiFetch(`/videos/${id}/content`, {
    method: "GET",
  });
  const bytes = Buffer.from(await contentRes.arrayBuffer());
  return {
    kind: "video",
    bytes,
    extension: "mp4",
    mimeType: "video/mp4",
    provider: "openai",
    model,
    prompt,
  };
}

const openAIProvider: GenerativeProvider = {
  name: "openai",
  async generateAsset(input) {
    if (input.kind === "image") return generateOpenAIImage(input);
    return generateOpenAIVideo(input);
  },
};

function unsupportedProvider(name: GenerativeProviderName): GenerativeProvider {
  return {
    name,
    async generateAsset() {
      throw new Error(
        `${name} provider is registered but not implemented in this first pass.`
      );
    },
  };
}

const mockProvider: GenerativeProvider = {
  name: "mock",
  async generateAsset(input) {
    const prompt = requirePrompt(input.prompt);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#111827"/><text x="64" y="120" fill="#f9fafb" font-size="48" font-family="Arial">Generated placeholder</text><text x="64" y="200" fill="#cbd5e1" font-size="28" font-family="Arial">${prompt
      .replace(/[<>&]/g, "")
      .slice(0, 90)}</text></svg>`;
    return {
      kind: "image",
      bytes: Buffer.from(svg),
      extension: "svg",
      mimeType: "image/svg+xml",
      provider: "mock",
      model: "mock-svg",
      prompt,
    };
  },
};

export function providerFor(name: string): GenerativeProvider {
  switch (name.toLowerCase()) {
    case "openai":
      return openAIProvider;
    case "gemini":
      return unsupportedProvider("gemini");
    case "nanobanano":
    case "nano-banano":
    case "nano_banano":
      return unsupportedProvider("nanobanano");
    case "mock":
      return mockProvider;
    default:
      throw new Error(`Unknown generative provider: ${name}`);
  }
}
