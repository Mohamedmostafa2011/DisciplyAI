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
              database: name === 'delete_homework' ? 'homework' : 'tasks',
              query: args.query || ''
            }).catch(() => ({}));
            const target = look?.match || { id: args.id, title: args.title || 'this item', subject: args.subject };
            return json(res, 200, {
              reply: 'Just to be safe, please confirm this deletion.',
              tools: executed,
              confirm: {
                tool: name,
                target: { id: target.id, title: target.title, subject: target.subject },
                message: `Are you sure you want to delete this ${name === 'delete_homework' ? 'homework' : 'task'}?`
              }
            });
          }

          executed.push({ name, ok: !result?.error, label: result?.error ? `Couldn't complete: ${TOOL_LABELS[name] || name}` : DONE_LABELS[name] });
          convo.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 12000) });
        }
        continue; // let the AI read the tool output
      }

      return json(res, 200, { reply: ai.content || 'Done.', tools: executed });
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
  // Defaults to Groq — a genuinely free, OpenAI-compatible provider that
  // supports tool calling. Override with AI_BASE_URL / AI_MODEL for OpenAI,
  // OpenRouter, Together, xAI Grok, or a local model server.
  const base = (cleanEnv(process.env.AI_BASE_URL, 'AI_BASE_URL') || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = cleanEnv(process.env.AI_MODEL, 'AI_MODEL') || 'openai/gpt-oss-120b';

  // Providers retire models periodically. If the configured one is gone, fall
  // back to a current tool-calling model instead of failing the whole request.
  const FALLBACKS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'groq/compound'];
  const candidates = [model, ...FALLBACKS.filter((m) => m !== model)];
  let lastErr;

  for (const candidate of candidates) {
    try {
      return await requestModel(base, candidate, messages);
    } catch (e) {
      lastErr = e;
      // Only try the next model when THIS model is the problem.
      if (!e.modelGone) throw e;
      console.warn(`[ai] model "${candidate}" unavailable — trying next`);
    }
  }
  throw lastErr;
}

async function requestModel(base, model, messages) {

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanEnv(process.env.AI_API_KEY, 'AI_API_KEY')}`, // server-side only
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      tools: TOOL_SCHEMAS.map((t) => ({ type: 'function', function: t })),
      tool_choice: 'auto'
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[ai error]', res.status, detail.slice(0, 500)); // server log only
    let reason;
    if (res.status === 429) reason = 'The AI service is rate-limited right now. Please wait a few seconds and try again.';
    else if (res.status === 401 || res.status === 403) {
      reason = 'The AI provider rejected the API key (401). Open /api/diagnose for the exact reason — usually the key was revoked, is from a different provider, or has stray characters.';
    }
    else if (res.status === 404 || /model_decommissioned|model_not_found|does not exist|decommission/i.test(detail)) {
      const e2 = new Error(`The AI model "${model}" has been retired by the provider. Set AI_MODEL to a current one (e.g. openai/gpt-oss-120b).`);
      e2.modelGone = true; e2.hint = 'ai';
      throw e2;
    }
    else if (res.status === 400) reason = 'The AI provider rejected the request. This usually means the chosen model does not support tool calling.';
    else reason = `The AI service returned an error (${res.status}).`;
    const e = new Error(reason);
    e.hint = 'ai';
    throw e;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: msg.tool_calls || [] };
}
