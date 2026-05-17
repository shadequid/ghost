# Custom Models

Ghost can route to any OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, SGLang, or a proxy — through `~/.ghost/models.json`. No code changes, no rebuild.

The file is optional. When absent, Ghost uses the built-in pi-ai provider list. When present, custom entries are layered on top; pi-ai built-ins are never shadowed.

## Quick Start (Ollama)

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "qwen3:8b" },
        { "id": "llama3.1:8b" }
      ]
    }
  }
}
```

Then in `~/.ghost/config.json`:

```json
{ "provider": "ollama", "model": "qwen3:8b" }
```

Verify: `ghost doctor` lists the provider and `ghost providers --models ollama` shows the models.

## vLLM / Self-Hosted

```json
{
  "providers": {
    "vllm": {
      "baseUrl": "http://vllm.internal:8000/v1",
      "api": "openai-completions",
      "apiKey": "EMPTY",
      "models": [
        { "id": "meta-llama/Llama-3.1-70B", "contextWindow": 131072 }
      ]
    }
  }
}
```

## LM Studio

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        { "id": "qwen2.5-coder-7b-instruct" }
      ]
    }
  }
}
```

## Schema

### Provider

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `baseUrl` | yes | — | Appended with `/v1` automatically if missing. |
| `api` | no | `openai-completions` | Currently only `openai-completions` is supported for custom endpoints. |
| `apiKey` | no | — | Literal string; required by most servers even if ignored (e.g. Ollama). |
| `compat` | no | auto | OpenAI compat flags. Ollama localhost auto-disables `developer` role and `reasoning_effort`. |
| `models` | yes | — | Non-empty array. |

### Model

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `id` | yes | — | Passed directly to the endpoint. |
| `name` | no | `id` | Human-readable label. |
| `reasoning` | no | `false` | Enable if the model supports extended thinking. |
| `input` | no | `["text"]` | Add `"image"` for multimodal models. |
| `contextWindow` | no | `128000` | |
| `maxTokens` | no | `16384` | Maximum completion tokens. |
| `cost` | no | all zeros | `{ input, output, cacheRead, cacheWrite }` per million tokens. |
| `compat` | no | provider `compat` | Per-model override. |

### Reserved Names

The following provider names are **reserved** and cannot appear in `models.json`:

- All pi-ai built-ins: `openai`, `anthropic`, `google`, `openrouter`, `xai`, `groq`, `cerebras`, `mistral`, `huggingface`, etc.
- Ghost specials: `claude-cli`, `custom`.

Pick a distinct name if you want to proxy one of these — `openai-proxy`, `anthropic-bedrock`, etc. Shadowing built-ins is a future feature and intentionally deferred.

## Auto-Detected Compat

When `baseUrl` points at the default Ollama port (`:11434`) and you haven't set `compat`, Ghost applies:

```json
{
  "supportsDeveloperRole": false,
  "supportsReasoningEffort": false
}
```

These avoid sending request shapes Ollama rejects. Override per provider or per model if you know better.

### Qwen on Ollama — thinking mode auto-disabled

Qwen3 (and Qwen2.5) ship with **thinking mode on by default** in Ollama. The model wraps every response in `<think>…</think>` before emitting the real answer — which breaks tool calls (the model never reaches the `<tool_call>` block) and structured-JSON prompts like the news curator.

When Ghost sees a Qwen model id (`qwen3:8b`, `qwen2.5-coder:7b`, etc.) on an Ollama endpoint, it auto-applies:

```json
{
  "reasoning": true,
  "compat": { "thinkingFormat": "qwen-chat-template" }
}
```

Counterintuitive but this is pi-ai's contract: `reasoning: true` enables the injection path that sends `chat_template_kwargs: { enable_thinking: false }` to Ollama — because no `reasoningEffort` is passed at call-time, thinking is explicitly **disabled**. Users who want thinking on: set `reasoning: false` in their model entry, or pass `reasoningEffort: "high"` via the agent config (not currently exposed).

This auto-detect only fires on Ollama endpoints (`:11434`). vLLM / LM Studio / SGLang handle Qwen's thinking controls differently — set `compat.thinkingFormat` yourself in those cases.

## Tool Calling with Local Models

Ghost's trading agent uses 40+ tools with detailed schemas. Small local models struggle with this:

| Model size | Practical tool-call accuracy |
|---|---|
| 7-8B (qwen3:8b, llama3.1:8b) | ~30-50% — unreliable, frequent skipped calls |
| 14B (qwen3:14b, qwen2.5-coder:14b) | ~70-85% — usable for dev / experimentation |
| 32B+ (qwen3:32b, deepseek-v3) | ~90%+ — production-ish |

Before reporting a tool-calling bug, confirm:

```bash
# 1. Model template must include {{- if .Tools }}
ollama show <model> --template | grep -i "tool\|function"

# 2. Thinking must be OFF (verified by sampled request logs)
ghost daemon -v 2>&1 | grep -i "enable_thinking\|chat_template_kwargs"
```

If the template lacks a `Tools` clause, re-pull (`ollama rm <model> && ollama pull <model>`) or pick a Modelfile with tool support.

## API Key Resolution

For custom providers, the `apiKey` in `models.json` is returned directly — no env or shell interpolation (that's a future enhancement; see pi-mono's `coding-agent/docs/models.md` for the target syntax).

### File Permissions

`~/.ghost/models.json` is written with **`0o600`** (owner read/write only), matching `config.json` and `credentials.json`. Ghost stores whatever you put in `apiKey` as **plaintext** — unlike `credentials.json`, which is encrypted. If you hand-edit the file, keep it at `0o600` (`chmod 600 ~/.ghost/models.json`) so other local users cannot read real API keys.

## Using the Wizard

`ghost onboard` → pick **Custom** → wizard asks for:

1. Provider name (default `ollama`)
2. Base URL (default `http://localhost:11434/v1`)
3. API key (default `ollama` for local, `EMPTY` otherwise)
4. Model ID

The wizard writes the entry to `~/.ghost/models.json`, merging with any existing providers. Running it again updates the same provider without touching others.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `Unknown model: <provider>/<model>` at daemon boot | Run `ghost doctor` — it lists what's in models.json and surfaces load errors. |
| `schema validation failed` in doctor | Compare against this page's quick-start example; all required fields present? |
| Requests 400 against Ollama | Make sure `compat.supportsDeveloperRole = false` (auto-applied on localhost:11434). |
| Qwen responses contain `<think>` blocks | Confirm `ollama show <model> --template` supports tools; ensure your Ghost config doesn't override `config.agent.thinkingLevel` for the model. Ghost auto-forces thinking off for Qwen-on-Ollama (see the Qwen auto-detect section above). Verify with `ghost daemon -v 2>&1 \| grep enable_thinking` — should log `false`. |
| Tool calls fail or are skipped on local Qwen/Llama | Confirm model template includes a Tools clause: `ollama show <model> --template \| grep -i "tool\|function"`. Re-pull a tool-capable Modelfile if missing. See the tool-call accuracy table above. |
| Want to use a proxy in front of a real provider | Reserved names can't be shadowed yet — wrap with a distinct name (e.g. `openai-proxy`) and point `config.provider` at that. |

## Migrating from `config.apiUrl`

The legacy `config.apiUrl` field is deprecated. It's still readable for back-compat (Ghost emits a warning if set), but new installs use `models.json`. To migrate: run `ghost onboard` and pick Custom — it writes the new file and leaves your old `apiUrl` in place until you remove it.
