import type { FlagEmbedding } from "fastembed";
import { env } from "@/lib/env";

/**
 * Local embeddings via fastembed. The default model is BAAI/bge-small-en-v1.5
 * (384-dim), matching the pgvector column. The model (~90MB) downloads once to
 * EMBEDDING_CACHE_DIR on first use; there is no external API and no key.
 *
 * fastembed is imported dynamically (not at the top level) on purpose: it pulls
 * in onnxruntime-node's native binary, whose dlopen runs at module-load time. A
 * static import would trigger that at cold start for every route that transitively
 * imports this file (the whole interview flow does, via resume.service), crashing
 * routes that never embed anything — and on serverless hosts where the native .so
 * isn't bundled, it crashes *before* callers' try/catch can see it. Loading it
 * lazily means only real embed() calls touch onnxruntime, and those call sites
 * already degrade gracefully when it's unavailable.
 *
 * Initialization is lazy + memoized so the model loads on first embed only.
 */
let modelPromise: Promise<FlagEmbedding> | null = null;

/**
 * fastembed's built-in download (Qdrant's public GCS bucket) is no longer
 * publicly readable, so fetch the same quantized ONNX model from Qdrant's
 * Hugging Face repo into the directory layout fastembed expects. fastembed
 * then finds the model directory and skips its own download.
 */
const HF_MODEL_BASE =
  "https://huggingface.co/Qdrant/bge-small-en-v1.5-onnx-q/resolve/main";
const MODEL_FILES = [
  "model_optimized.onnx",
  "tokenizer.json",
  "config.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
];

async function ensureModelFiles(cacheDir: string, modelName: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const modelDir = path.join(cacheDir, modelName);
  const exists = await fs.stat(modelDir).then(() => true, () => false);
  if (exists) return;

  // A failed GCS download leaves an error page behind as the .tar.gz, which
  // fastembed would otherwise keep trying to extract.
  await fs.rm(path.join(cacheDir, `${modelName}.tar.gz`), { force: true });

  // Download into a temp dir and rename, so a crash never leaves a partial model.
  const tmpDir = `${modelDir}.partial-${process.pid}`;
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    for (const file of MODEL_FILES) {
      const res = await fetch(`${HF_MODEL_BASE}/${file}`);
      if (!res.ok) throw new Error(`Model download failed: ${file} (${res.status})`);
      await fs.writeFile(path.join(tmpDir, file), Buffer.from(await res.arrayBuffer()));
    }
    await fs.rename(tmpDir, modelDir);
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    // Another request may have finished the same download concurrently.
    if (await fs.stat(modelDir).then(() => true, () => false)) return;
    throw err;
  }
}

function getModel(): Promise<FlagEmbedding> {
  modelPromise ??= (async () => {
    const { EmbeddingModel, FlagEmbedding } = await import("fastembed");
    await ensureModelFiles(env.EMBEDDING_CACHE_DIR, EmbeddingModel.BGESmallENV15);
    return FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
      cacheDir: env.EMBEDDING_CACHE_DIR,
      maxLength: 512,
    });
  })().catch((err) => {
    // Reset so a later call can retry (e.g. after a transient cold download).
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

export const EMBEDDING_DIM = 384;

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = await getModel();
  const out: number[][] = [];
  for await (const batch of model.embed(texts, 32)) {
    for (const vec of batch) out.push(Array.from(vec));
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec ?? [];
}

/** pgvector literal, e.g. "[0.12,-0.03,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
