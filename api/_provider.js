/**
 * api/_provider.js — AUTO-DETECT the AI provider from the API key.
 *
 * Users understandably mix up "Grok" (xAI) and "Groq" (LPU inference), and a
 * key from one provider sent to the other's URL always returns 401.
 * We therefore trust the KEY PREFIX over any configured base URL.
 */

export const PROVIDERS = {
  xai: {
    name: 'xAI (Grok)',
    base: 'https://api.x.ai/v1',
    match: (k) => k.startsWith('xai-'),
    models: ['grok-3-mini', 'grok-3', 'grok-2-1212', 'grok-beta']
  },
  groq: {
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    match: (k) => k.startsWith('gsk_'),
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'groq/compound-mini', 'llama-3.1-8b-instant']
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    match: (k) => k.startsWith('sk-or-'),
    models: ['meta-llama/llama-3.3-70b-instruct', 'openai/gpt-4o-mini']
  },
  openai: {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    match: (k) => k.startsWith('sk-'),
    models: ['gpt-4o-mini', 'gpt-4o']
  }
};

/**
 * Works out which provider a key belongs to.
 * @returns {{key:string, name:string, base:string, models:string[], autoRouted:boolean}}
 */
export function detectProvider(apiKey, configuredBase) {
  const k = String(apiKey || '');
  const knownHosts = Object.values(PROVIDERS).map((p) => new URL(p.base).host);

  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.match(k)) {
      const host = new URL(p.base).host;
      // Only override when the configured URL belongs to a DIFFERENT known
      // provider (the classic Grok/Groq mix-up). A custom or self-hosted
      // endpoint is always respected.
      const pointsAtOtherKnown = !!configuredBase &&
        knownHosts.some((h) => h !== host && configuredBase.includes(h));
      return { id, name: p.name, base: p.base, models: p.models, autoRouted: pointsAtOtherKnown };
    }
  }
  // Unknown prefix — honour whatever was configured.
  return {
    id: 'custom',
    name: 'custom provider',
    base: configuredBase || PROVIDERS.groq.base,
    models: PROVIDERS.groq.models,
    autoRouted: false
  };
}
