# LLM Providers — Which One Should I Pick?

Ghost can use any LLM provider: OpenAI, Anthropic, Google Gemini, OpenRouter, and 20+ others. This guide helps you choose.

## Decision Table

| Provider | Auth | Cost | Best for | Caveats |
|----------|------|------|----------|---------|
| **Anthropic (API)** | API key | Pay-as-you-go (~$3–15/M1 token) | Best reasoning, long context | Need Claude subscription or API credits |
| **Anthropic (OAuth)** | Browser login | Same as API key | Same, no key management | Seamless login, better privacy |
| **Claude Code CLI** | Subscription (no API key) | Included in subscription | Claude Opus models, zero config | Requires Claude Code subscription |
| **OpenAI** | API key | Pay-as-you-go (~$0.02–$3/1K tokens) | Latest GPT-5 models, very fast | Most expensive on high volume |
| **OpenRouter** | 1 API key | Pay-as-you-go, 200+ models | Comparison shopping, rare models | Rate limits per model, no filter |
| **Google Gemini** | API key | Pay-as-you-go (~free tier, then ~$0.075/1M tokens) | Budget-conscious, Gemini 2.0 | Free tier limited to 1500 RPM |
| **Groq** | API key | Free or very cheap | Ultra-fast inference (LPU) | Smaller model set, less reasoning |
| **Custom (Ollama/vLLM)** | None | Free (local) or self-hosted | Full privacy, no API costs, offline | Slow (CPU) or requires GPU, setup required |

## Authentication Methods

### API Key
Paste a key into `~/.ghost/config.json`. Keys never leave your machine—Ghost sends them directly to the provider's API.

### OAuth
Log in via your browser. Recommended for privacy—Ghost never sees your password, and keys are rotated regularly.

### Claude Code CLI
If you have a Claude Code subscription, Ghost can use it directly—no API key needed. Just select "Claude Code" during onboard.

### Custom (Ollama / vLLM)
No authentication. Configure the base URL (e.g., `http://localhost:11434/v1`) in `~/.ghost/models.json`. See **[./CUSTOM_MODELS.md](./CUSTOM_MODELS.md)**.

## Local vs Cloud

### Cloud (Recommended for most users)
- Instant setup, no hardware requirements
- Faster inference, wider model selection
- Pay only for what you use
- API keys encrypted in `~/.ghost/config.json`

### Local (Ollama / vLLM)
- **Privacy:** All requests stay on your machine, nothing sent to cloud
- **Cost:** Free (just electricity and hardware)
- **Latency:** Depends on your GPU/CPU (typically 5–30 tokens/sec on consumer GPU)
- **Setup:** Download Ollama or vLLM, configure in Ghost

**Trade-off:** Local is slower and requires a decent GPU (~8GB VRAM for 7B models, ~16GB for 13B+). Cloud is instant and handles reasoning tasks much better.

## Switching Providers

To change your provider or model at any time:

```bash
bun run dev onboard
```

Select a new provider and model. Your existing chat history, memory, positions, and settings are preserved. Ghost starts using the new LLM immediately.

## Detailed Guides

For complete setup steps for each provider, OAuth login, and self-hosted options, see **[./CUSTOM_MODELS.md](./CUSTOM_MODELS.md)** for Ollama/vLLM/LM Studio.

## Recommended Starting Points

- **Want the best reasoning?** → Anthropic (API or OAuth)
- **Want low cost?** → Google Gemini (free tier) or Groq
- **Want simplicity?** → Claude Code subscription (no key management)
- **Want full privacy?** → Ollama (local, free, offline)
- **Want everything at once?** → OpenRouter (200+ models, 1 key)

Run `bun run dev providers` to see all available options and current status. Run `bun run dev doctor` to test your current provider's connectivity.
