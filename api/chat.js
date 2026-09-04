/**
 * POST /api/chat — the AI tool-calling loop.
 * ===========================================================================
 * Browser -> here -> AI service (AI_API_KEY) -> tool choice
 *                 -> backend executes tool -> Notion (NOTION_TOKEN)
 *                 -> AI writes the final natural-language reply.
 *
 * No secret is ever included in the response body.
 * ===========================================================================
 */
import { requireAuth } from './_auth.js';
import { TOOL_SCHEMAS, TOOL_LABELS, DONE_LABELS, executeTool, systemPrompt } from './_tools.js';
import { SETTINGS } from './_config.js';
import { cleanEnv } from './_env.js';
import { detectProvider } from './_provider.js';

const MAX_TOOL_ROUNDS = 5;

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!requireAuth(req, res)) return;

  let payload;
  try { payload = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
  catch { return json(res, 400, { error: 'Invalid request.' }); }

  const { messages = [], today, timezone = SETTINGS.timezone, confirmedAction } = payload;
  const executed = [];
  let lastToolError = null;

  try {
    /* --- Path A: the user confirmed a pending destructive action ------ */
    if (confirmedAction?.tool && confirmedAction?.target?.id) {
      const result = await executeTool(confirmedAction.tool, { id: confirmedAction.target.id, confirmed: true }, { confirmed: true });
      executed.push({ name: confirmedAction.tool, ok: !result.error, label: DONE_LABELS[confirmedAction.tool] });
      if (result.error) return json(res, 200, { reply: `I couldn't delete that: ${result.error}`, tools: executed });
      const t = confirmedAction.target;
      return json(res, 200, {
        reply: `Deleted.\n\n**${[t.subject, t.title].filter(Boolean).join(' — ')}** has been removed from Notion.`,
        tools: executed
      });
    }

    if (!cleanEnv(process.env.AI_API_KEY, 'AI_API_KEY')) {
      return json(res, 200, {
        reply: "The AI service isn't configured yet. Add an `AI_API_KEY` environment variable on the server to enable natural-language understanding.",
        tools: []
      });
    }

    /* --- Path B: normal AI tool-calling loop --------------------------- */
    const convo = [
      { role: 'system', content: systemPrompt(today || new Date().toISOString().slice(0, 10), timezone) },
      ...messages.filter((m) => m && m.content).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).slice(0, 8000)
      }))
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const ai = await callAI(convo);

      if (ai.toolCalls?.length) {
        convo.push({ role: 'assistant', content: ai.content || '', tool_calls: ai.toolCalls });

        for (const call of ai.toolCalls) {
          const name = call.function.name;
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}

          let result;
          try { result = await executeTool(name, args); }
          catch (err) { result = { error: err.message || 'That Notion operation failed.' }; }

          // Destructive action -> bounce back to the UI for confirmation.
          if (result?.needsConfirmation) {
            const look = await executeTool('find_item', {
              database: name === 'delete_homework' ? 'homework' : name === 'delete_quiz' ? 'quizzes' : 'tasks',
              query: args.query || ''
            }).catch(() => ({}));
            const target = look?.match || { id: args.id, title: args.title || 'this item', subject: args.subject };
            return json(res, 200, {
              reply: 'Just to be safe, please confirm this deletion.',
              tools: executed,
              confirm: {
                tool: name,
                target: { id: target.id, title: target.title, subject: target.subject },
                message: `Are you sure you want to delete this ${name === 'delete_homework' ? 'homework' : name === 'delete_quiz' ? 'quiz' : 'task'}?`
              }
            });
          }

          if (result?.error) {
            console.error(`[tool] ${name} failed:`, result.error);
            // A schema/config error will never succeed on retry — stop now.
            const fatal = /did not match your Notion database schema|is not a property|could not be found|Invalid request URL|not configured|does not have access|invalid or was revoked/i.test(result.error);
            if (fatal || lastToolError === result.error) {
              return json(res, 200, {
                reply: `I couldn't reach your Notion database.\n\n**Notion says:** ${result.error}\n\n` +
                       (/Invalid request URL/i.test(result.error)
                         ? `That means the **database ID is malformed**. In Vercel, set \`NOTION_DB_TASKS\` and \`NOTION_DB_HOMEWORK\` to the **full Notion URL** of each database (copy it straight from your browser's address bar), then redeploy.`
                         : `Open **/api/diagnose** — it prints your real Notion columns next to what \`api/_config.js\` expects.`),
                tools: [...executed, { name, ok: false, label: `${TOOL_LABELS[name] || name} — ${result.error}` }]
              });
            }
            lastToolError = result.error;
          }
          executed.push({
            name,
            ok: !result?.error,
            label: result?.error ? `${TOOL_LABELS[name] || name} — ${result.error}` : DONE_LABELS[name],
            error: result?.error || undefined
          });
          convo.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 12000) });
        }
        continue; // let the AI read the tool output
      }

      if (executed.length && executed.every((t) => t.ok === false)) {
        const why = executed[0].error || 'Notion did not accept the request.';
        return json(res, 200, {
          reply: `I couldn't read your Notion databases, so I can't answer that accurately yet.\n\n` +
                 `**Notion says:** ${why}\n\n` +
                 (/Invalid request URL/i.test(why)
                   ? `**Fix:** the database ID is malformed. In Vercel set \`NOTION_DB_TASKS\` and \`NOTION_DB_HOMEWORK\` to the **full Notion URL** of each database, then redeploy.`
                   : `Open **/api/diagnose** for the exact mismatch.`),
          tools: executed
        });
      }

      const note = ai.toolsUnavailable
        ? "\n\n_Note: the current AI model can't run Notion actions, so I answered from the conversation only. Set `AI_MODEL` to a function-calling model to enable reading and writing Notion._"
        : '';
      return json(res, 200, { reply: (ai.content || 'Done.') + note, tools: executed });
    }

    if (lastToolError) {
      return json(res, 200, {
        reply: `I couldn't save that to Notion.\n\n**Notion says:** ${lastToolError}\n\n` +
               `This is almost always a **column-name mismatch**. Open \`/api/diagnose\` — ` +
               `it lists your real Notion column names next to what \`api/_config.js\` expects.`,
        tools: executed
      });
    }
    return json(res, 200, { reply: "That took more steps than expected. Could you try asking in a simpler way?", tools: executed });
  } catch (err) {
    // Log the real reason server-side (visible in Vercel -> Logs), but never
    // return a token, env var value, or stack trace to the browser.
    console.error('[chat error]', err?.code || '', err?.message);
    const safe = scrub(err?.message) || 'Something went wrong.';
    return json(res, 200, {
      reply: `${safe}\n\n_Your Notion data hasn't been changed._`,
      tools: executed,
      hint: err?.hint || undefined
    });
  }
}

/**
 * Removes anything secret-shaped from an error message while keeping the
 * diagnostic meaning intact, so the user sees WHY it failed.
 */
function scrub(msg) {
  if (!msg) return '';
  return String(msg)
    .replace(/(gsk_|sk-|ntn_|secret_)[A-Za-z0-9_-]+/g, '***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/\bat\s+\S+\.js:\d+:\d+/g, '')
    .slice(0, 300);
}

/**
 * Calls the AI provider. Defaults to an OpenAI-compatible chat completions API,
 * so it works with OpenAI, Groq, Together, OpenRouter, a local server, etc.
 * Configure with AI_API_KEY, and optionally AI_BASE_URL / AI_MODEL.
 */
async function callAI(messages) {
  const apiKey = cleanEnv(process.env.AI_API_KEY, 'AI_API_KEY');
  const configuredBase = cleanEnv(process.env.AI_BASE_URL, 'AI_BASE_URL').replace(/\/$/, '');
  const configuredModel = cleanEnv(process.env.AI_MODEL, 'AI_MODEL');

  // Route by the KEY, not the URL. A Grok (xai-) key sent to Groq — or the
  // reverse — is the single most common cause of a persistent 401.
  const p = detectProvider(apiKey, configuredBase);
  if (p.autoRouted) {
    console.warn(`[ai] key looks like ${p.name}; ignoring AI_BASE_URL and using ${p.base}`);
  }
  const base = p.autoRouted ? p.base : (configuredBase || p.base);

  // Ask the provider which models THIS key can actually use. Hard-coded lists
  // go stale as providers retire models, so live discovery is authoritative.
  const live = await listModels(base, apiKey);

  let candidates;
  if (live.length) {
    const usable = live.filter(isChatModel);
    // Prefer the configured model, then known-good ones, then anything usable.
    const preferred = [configuredModel, ...p.models].filter((m) => m && usable.includes(m));
    candidates = [...new Set([...preferred, ...rankModels(usable)])];
    console.log(`[ai] ${usable.length} usable models; trying: ${candidates.slice(0, 4).join(', ')}`);
  } else {
    candidates = [...new Set([configuredModel, ...p.models].filter(Boolean))];
  }
  if (!candidates.length) {
    const e = new Error('The AI provider returned no usable models for this API key.');
    e.hint = 'ai';
    throw e;
  }
  let lastErr;

  for (const candidate of candidates) {
    try {
      return await requestModel(base, candidate, messages, apiKey);
    } catch (e) {
      lastErr = e;
      if (!e.modelGone) throw e;
      console.warn(`[ai] "${candidate}" failed on ${p.name} — trying next`);
    }
  }

  if (lastErr?.authLike) {
    const e = new Error(
      `${p.name} rejected every model.\n\n` +
      `**${p.name} says:** "${lastErr.providerSays || 'Invalid API Key'}"\n\n` +
      `Key sent: starts \`${apiKey.slice(0, 4)}\`, length ${apiKey.length} → ${base}\n\n` +
      (apiKey.length < 40
        ? '⚠️ That key looks **too short** — a Groq key is around 56 characters, so it was probably truncated when pasted.'
        : 'The key reached the provider but was refused. Create a new key at console.groq.com, delete and re-add `AI_API_KEY`, then redeploy.')
    );
    e.hint = 'ai';
    throw e;
  }
  // Last resort: if every model refused the `tools` parameter, run the best one
  // without tools so the student still gets a useful (read-only) answer.
  if (lastErr?.badRequest && candidates.length) {
    try {
      console.warn('[ai] no model accepted tools — retrying without them');
      const out = await requestModel(base, candidates[0], messages, apiKey, false);
      out.toolsUnavailable = true;
      return out;
    } catch { /* fall through to the report below */ }
  }

  if (lastErr?.orgBlocked) {
    const e = new Error(
      `Your Groq account has **all models disabled at the organisation level**.\n\n` +
      `**Fix it here → https://console.groq.com/settings/limits**\n\n` +
      `Enable at least one of these (they support tool calling):\n` +
      `- \`openai/gpt-oss-20b\`  ← recommended\n` +
      `- \`openai/gpt-oss-120b\`\n\n` +
      `Then send a message again — no redeploy needed.\n\n` +
      `_Groq said: "${lastErr.providerSays || 'blocked at the organization level'}"_`
    );
    e.hint = 'ai';
    throw e;
  }

  if (lastErr?.modelGone) {
    const usable = rankModels(live.filter(isChatModel)).slice(0, 12);
    const all = rankModels(live).slice(0, 20);
    const e = new Error(
      `None of the available models accepted the request on ${p.name}.\n\n` +
      (lastErr.providerSays ? `**${p.name} says:** "${lastErr.providerSays}"\n\n` : '') +
      (usable.length
        ? `**Tool-calling candidates tried:**\n${usable.map((m) => `- \`${m}\``).join('\n')}\n\n`
        : `**No tool-calling models found on this account.**\n\nAll models your key can see:\n${all.map((m) => `- \`${m}\``).join('\n')}\n\n`) +
      `Set \`AI_MODEL\` to a model that supports function calling, then redeploy.`
    );
    e.hint = 'ai';
    throw e;
  }
  throw lastErr;
}

/** GET /models — returns the ids this key may use ([] if unsupported). */
async function listModels(base, apiKey) {
  try {
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).map((m) => m.id).filter(Boolean);
  } catch { return []; }
}

/**
 * ALLOWLIST. Providers expose speech, TTS, vision and moderation models in the
 * same /models list as chat models, so an exclusion list can never be complete
 * (e.g. "canopylabs/orpheus-v1-english" is a text-to-speech model).
 * We therefore only accept model families known to do text chat + tool calling.
 */
const CHAT_FAMILIES = [
  /^openai\/gpt-oss-\d+b/i,        // gpt-oss-20b / 120b  (best on Groq)
  /^qwen[/-]/i,                     // qwen3 family
  /^meta-llama\/llama-4/i,          // llama 4 scout / maverick
  /^llama-3\.[13]-\d+b/i,           // llama 3.1 / 3.3
  /^moonshotai\/kimi/i,
  /^mistral/i,
  /^gpt-4/i, /^gpt-5/i, /^o[34]-/i, // OpenAI
  /^grok-/i                         // xAI
];

const NEVER = /whisper|tts|orpheus|canopylabs|playai|speech|audio|embed|guard|safeguard|moderation|rerank|vision-only|compound|allam|prompt-?guard/i;

function isChatModel(id) {
  if (NEVER.test(id)) return false;
  return CHAT_FAMILIES.some((re) => re.test(id));
}

/** Best general/tool-calling models first. */
function rankModels(ids) {
  const score = (id) => {
    let n = 0;
    if (/gpt-oss-120b/.test(id)) n += 100;
    if (/gpt-oss-20b/.test(id)) n += 90;
    if (/qwen/.test(id)) n += 60;
    if (/llama-4|maverick|scout/.test(id)) n += 55;
    if (/70b|120b/.test(id)) n += 20;
    if (/instant|mini|8b/.test(id)) n += 5;
    if (/preview|deprecated/.test(id)) n -= 30;
    return n;
  };
  return [...ids].sort((a, b) => score(b) - score(a));
}

async function requestModel(base, model, messages, apiKey, useTools = true) {

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`, // server-side only
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      ...(useTools
        ? { tools: TOOL_SCHEMAS.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' }
        : {})
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[ai error]', res.status, detail.slice(0, 500)); // server log only
    let reason;
    if (res.status === 429) reason = 'The AI service is rate-limited right now. Please wait a few seconds and try again.';
    else if (/blocked at the organization level|not enabled|enable this model/i.test(detail)) {
      let says = '';
      try { says = JSON.parse(detail)?.error?.message || ''; } catch { says = detail.slice(0, 200); }
      const eb = new Error(`Model "${model}" is blocked in your Groq organisation settings.`);
      eb.modelGone = true;          // try the next candidate
      eb.orgBlocked = true;
      eb.providerSays = scrub(says);
      eb.hint = 'ai';
      throw eb;
    }
    else if (res.status === 401 || res.status === 403) {
      // 401/403 can mean bad key OR "model not enabled for this account".
      // Try other models first; remember the provider's own wording.
      let providerSays = '';
      try { providerSays = JSON.parse(detail)?.error?.message || ''; } catch { providerSays = detail.slice(0, 160); }
      const e2 = new Error(`The provider returned ${res.status} for model "${model}".`);
      e2.modelGone = true;
      e2.authLike = true;
      e2.providerSays = scrub(providerSays);
      e2.hint = 'ai';
      throw e2;
    }
    else if (res.status === 404 || /model_decommissioned|model_not_found|does not exist|decommission/i.test(detail)) {
      const e2 = new Error(`The AI model "${model}" has been retired by the provider. Set AI_MODEL to a current one (e.g. openai/gpt-oss-120b).`);
      e2.modelGone = true; e2.hint = 'ai';
      throw e2;
    }
    else if (res.status === 400) {
      let says = '';
      try { says = JSON.parse(detail)?.error?.message || ''; } catch { says = detail.slice(0, 200); }
      const e3 = new Error(`Model "${model}" rejected the request: ${scrub(says) || 'bad request'}`);
      e3.modelGone = true;          // try the next candidate
      e3.providerSays = scrub(says);
      e3.badRequest = true;
      e3.hint = 'ai';
      throw e3;
    }
    else reason = `The AI service returned an error (${res.status}).`;
    const e = new Error(reason);
    e.hint = 'ai';
    throw e;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: msg.tool_calls || [] };
}
