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

    if (!process.env.AI_API_KEY) {
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
    // Never leak tokens, env vars or stack traces.
    const safe = /token|api[_ ]key|env|ENOTFOUND|stack/i.test(String(err?.message))
      ? 'Something went wrong on the server.'
      : (err?.message || 'Something went wrong.');
    return json(res, 200, { reply: `${safe}\n\n_Your Notion data hasn't been changed._`, tools: executed });
  }
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
  const base = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_API_KEY}`, // server-side only
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
    if (res.status === 429) throw new Error('The AI service is rate-limited right now. Please wait a moment and try again.');
    if (res.status === 401) throw new Error('The AI service rejected the configured key. Check AI_API_KEY on the server.');
    if (res.status === 404 || /model/i.test(detail)) throw new Error('The configured AI model is unavailable. Check the AI_MODEL environment variable.');
    throw new Error('The AI service is unavailable right now.');
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: msg.tool_calls || [] };
}
