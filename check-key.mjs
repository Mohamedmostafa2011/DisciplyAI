#!/usr/bin/env node
/**
 * check-key.mjs — test a Groq (or any OpenAI-compatible) API key in isolation.
 *
 *   node check-key.mjs gsk_your_key_here
 *
 * Nothing is uploaded anywhere except the provider you are testing.
 * The key is not written to disk or logged in full.
 */
const key = (process.argv[2] || process.env.AI_API_KEY || '').trim();
// Detect the provider from the key prefix — Grok (xAI) and Groq are different!
const DETECT = [
  ['xai-',   'https://api.x.ai/v1',            'xAI (Grok)'],
  ['gsk_',   'https://api.groq.com/openai/v1', 'Groq'],
  ['sk-or-', 'https://openrouter.ai/api/v1',   'OpenRouter'],
  ['sk-',    'https://api.openai.com/v1',      'OpenAI']
];
const hit = DETECT.find(([pre]) => (process.argv[2] || '').trim().startsWith(pre));
const base = (process.argv[3] || process.env.AI_BASE_URL || (hit ? hit[1] : 'https://api.groq.com/openai/v1')).replace(/\/$/, '');
const provider = hit ? hit[2] : 'unknown provider';

if (!key) {
  console.log('\nUsage: node check-key.mjs <your-api-key>\n');
  process.exit(1);
}

console.log('\n─── Disciplay AI key check ───────────────────────────');
console.log(`Detected : ${provider}`);
console.log(`Endpoint : ${base}`);
console.log(`Key      : ${key.slice(0, 6)}…${key.slice(-4)}  (length ${key.length})`);

const warn = [];
if (key !== process.argv[2]) warn.push('had surrounding whitespace');
if (/["']/.test(key)) warn.push('contains a quote character');
if (/\s/.test(key)) warn.push('contains a space or line break');
if (base.includes('api.groq.com') && !key.startsWith('gsk_')) warn.push('this endpoint is Groq but the key is not a gsk_ key');
if (base.includes('api.x.ai') && !key.startsWith('xai-')) warn.push('this endpoint is xAI but the key is not an xai- key');
if (warn.length) console.log(`⚠️  ${warn.join('; ')}`);

try {
  const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await r.text();

  if (r.status === 401) {
    console.log('\n❌ 401 UNAUTHORIZED — the provider rejected this key.\n');
    console.log('   Provider said:', text.slice(0, 300));
    console.log(`\n   This key was sent to ${provider}. If that is the WRONG provider,`);
    console.log('   that alone explains the 401 — Grok (xAI) and Groq are different companies.');
    console.log('   Grok keys start with "xai-" and come from console.x.ai');
    console.log('   Groq keys start with "gsk_" and come from console.groq.com\n');
    process.exit(1);
  }
  if (!r.ok) {
    console.log(`\n❌ HTTP ${r.status}\n`, text.slice(0, 300), '\n');
    process.exit(1);
  }

  const data = JSON.parse(text);
  const ids = (data.data || []).map((m) => m.id).sort();
  console.log('\n✅ KEY IS VALID.\n');
  console.log('Models your key can use:');
  ids.forEach((id) => console.log('   •', id));

  const want = process.env.AI_MODEL || 'openai/gpt-oss-120b';
  console.log(`\nConfigured AI_MODEL: ${want}`);
  console.log(ids.includes(want)
    ? '✅ That model is available.\n'
    : `❌ NOT in the list above — set AI_MODEL to one of them (try "openai/gpt-oss-120b").\n`);
} catch (e) {
  console.log('\n❌ Could not reach the provider:', e.message, '\n');
  process.exit(1);
}
