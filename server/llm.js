// A local language model, used to give CPU players something to say.
//
// Points at Ollama on this machine by default, so it costs nothing, needs no
// key, and keeps working when the college WiFi has no internet — the same
// constraint everything else here is built around.
//
//   LLM_URL     http://127.0.0.1:11434      where Ollama is listening
//   LLM_MODEL   qwen3:8b                    which model to ask
//   LLM_BOTS    0                           turn CPU writing off entirely
//
// Everything here is best-effort. A model that is slow, missing, or talking
// nonsense must never stall a match, so every call has a hard timeout and
// every caller has a canned fallback. `available` is probed once at boot
// rather than per request — a game loop cannot wait on a health check.

const URL = process.env.LLM_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.LLM_MODEL || 'qwen3:8b';
const ENABLED = process.env.LLM_BOTS !== '0';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 9000;

let available = false;
let model = MODEL;

export const llmReady = () => ENABLED && available;
export const llmModel = () => model;

/** Probes once at startup. Never throws — a missing model is not an error. */
export async function warmUpLLM() {
  if (!ENABLED) return false;
  try {
    const res = await fetch(`${URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name);
    if (!names.length) return false;
    // Prefer the requested model; otherwise take whatever is installed rather
    // than failing over a version suffix.
    model = names.includes(MODEL) ? MODEL : names[0];
    available = true;
    console.log(`[llm] CPU players will think with ${model}`);
    return true;
  } catch {
    return false;
  }
}

/** Thinking models wrap their reasoning in tags; nobody wants those. */
const stripThinking = (text) => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');

/**
 * Trims a model's answer down to one line a player can read. Deliberately
 * brutal — models pad, apologise and add commentary — which is exactly why
 * structured output must ask for `raw` instead.
 */
function clean(text) {
  return stripThinking(text)
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .split('\n')[0]
    .slice(0, 160)
    .trim();
}

/**
 * One short completion. Resolves to null on any problem at all — timeout,
 * model missing, empty answer — so callers can fall back without a try/catch.
 */
export async function say(prompt, { maxTokens = 60, temperature = 0.9, raw = false } = {}) {
  if (!llmReady()) return null;
  try {
    const res = await fetch(`${URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false, // qwen3 and friends reason out loud unless asked not to
        options: { temperature, num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const { response } = await res.json();
    // Structured output needs every line and every character; a game answer
    // needs one short line. Same call, two very different appetites.
    const text = raw ? stripThinking(response).trim() : clean(response);
    return text || null;
  } catch {
    return null; // slow, offline, or unhappy — the game carries on regardless
  }
}
