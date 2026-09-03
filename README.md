<div align="center">
  <img src="assets/logos/logo-horizontal.png" alt="Disciplay" width="300" />
  <h1>Disciplay AI</h1>
  <p><strong>A private, Notion-powered AI study assistant for IGCSE students.</strong></p>
</div>

---

> ### ⚠️ SECURITY WARNING
> **NEVER commit your Notion integration token, AI API key, password, or other secrets to GitHub.**
> All secrets live exclusively in server-side environment variables. This repository is designed to
> be safe to push publicly — the `.gitignore` excludes `.env` files, and no secret ever appears in
> the frontend, in `localStorage`, in the browser console, or in any client-side network request.

---

## What Disciplay AI is

Disciplay AI is a private chatbot that understands natural student language and manages academic
information stored in **two Notion databases — Tasks and Homework**. You talk to it normally — it
reads, creates, updates and deletes them on your behalf.

```
You:            What homework do I have tomorrow?
Disciplay AI:   You have 2 pieces of homework tomorrow:
                • Biology — Revise reproduction
                • Physics — Complete questions 1–10
                Would you like me to organise these into a study plan?
```

```
You:            Add Chemistry homework. Finish acids and bases by Monday.
Disciplay AI:   Creating Chemistry homework…
                Done. I added: Chemistry — Finish acids and bases, due Monday.
```

## Features

- 🔒 **Private** — full-screen password gate; nothing is visible until you authenticate
- 🧠 **Natural language** — understands "tomorrow", "Monday", "next week", "this weekend" in your timezone
- 🛠 **Controlled AI tools** — the AI can only call a fixed, validated set of Notion actions, never arbitrary API calls
- 📓 **Full CRUD on Notion** — read, create, update and delete homework and tasks (each with subject, due date and status)
- ⚠️ **Confirmation for deletions** — destructive actions always require an explicit confirm
- 💬 **Modern chat UX** — Markdown rendering, tables, task lists, typing indicator, live tool-status chips
- 🗂 **Chat history** — new / rename / delete conversations, stored locally in your browser
- ⚙️ **Settings** — session, Notion connection test, light/dark/system theme, Enter-to-send, timestamps
- 🧪 **Demo Mode** — the whole UI works with realistic sample data before any backend exists
- 📱 **Mobile-first** — swipe-open drawer, keyboard-aware composer, bottom-sheet modals, 44px touch targets, installable to your home screen
- ♿ **Accessible** — 320px → 1920px+, keyboard navigation, ARIA labels, focus states

## Project structure

```text
disciplay-ai/
├── index.html              # App shell: login screen, chat UI, modals
├── css/
│   └── style.css           # Complete design system (light + dark)
├── js/
│   ├── app.js              # Bootstrap & global wiring
│   ├── auth.js             # Password gate + session lifecycle
│   ├── chat.js             # Conversation state and the send/receive loop
│   ├── api.js              # The ONLY module that touches the network
│   ├── ui.js               # All DOM rendering
│   ├── store.js            # localStorage (chats + preferences only)
│   ├── markdown.js         # Tiny XSS-safe Markdown renderer
│   ├── dates.js            # Timezone-aware natural-language dates
│   ├── mock.js             # Demo Mode engine (mock AI + mock Notion)
│   └── config.js           # Frontend config — contains NO secrets
├── api/                    # Backend (serverless-function compatible)
│   ├── health.js           # GET  /api/health   — public readiness probe
│   ├── auth.js             # POST /api/auth     — login / logout / session
│   ├── chat.js             # POST /api/chat     — AI tool-calling loop
│   ├── notion.js           # GET  /api/notion   — status / databases
│   ├── _config.js          # ✏️ YOUR DATABASE IDS + PROPERTY NAMES
│   ├── _notion.js          # Notion service layer (uses NOTION_TOKEN)
│   ├── _tools.js           # The controlled tool surface given to the AI
│   └── _auth.js            # Signed HttpOnly session cookies
├── assets/logos/           # Official Disciplay logo assets
├── server.js               # Zero-dependency local/self-hosted server
├── .env.example            # Template — copy to .env (never committed)
├── .gitignore
└── README.md
```

## Local setup

Requires **Node.js 18+**. There are no npm dependencies.

```bash
git clone <your-repo-url>
cd disciplay-ai

cp .env.example .env        # then fill in your values
npm run dev                 # http://localhost:3000
```

Opening `index.html` directly also works — it simply runs in **Demo Mode**.

## Notion integration setup

1. Go to **https://www.notion.so/my-integrations** → *New integration*.
2. Give it a name (e.g. `Disciplay AI`), pick your workspace, and grant
   **Read**, **Insert** and **Update** content capabilities.
3. Copy the **Internal Integration Token** (starts with `ntn_`).
   → Put it in `.env` as `NOTION_TOKEN`. **Never paste it into any frontend file.**
4. Open **each** database you want Disciplay to manage → `•••` menu →
   **Connections** → add your integration. *(Without this step Notion returns
   "object_not_found" even with a valid token.)*
5. Copy each database ID from its URL:
   `https://notion.so/<workspace>/`**`1a2b3c4d5e6f7890abcd1234ef567890`**`?v=...`

## Database configuration

Everything lives in one place: **`api/_config.js`**. Edit the property `name`
values so they match your Notion columns **exactly** (they are case-sensitive),
and set the `type` for each.

```js
homework: {
  id: env('NOTION_DB_HOMEWORK', 'PASTE_HOMEWORK_DATABASE_ID_HERE'),
  properties: {
    title:   { name: 'Name',     type: 'title'     },  // ← your title column
    status:  { name: 'Status',   type: 'status'    },  // 'status' or 'select'
    dueDate: { name: 'Due Date', type: 'date'      },
    subject: { name: 'Subject',  type: 'select'    },  // or 'relation'
    notes:   { name: 'Notes',    type: 'rich_text' }
  },
  statusValues: { open: 'Not started', inProgress: 'In progress', done: 'Done' }
}
```

Supported types: `title`, `rich_text`, `select`, `multi_select`, `status`,
`date`, `checkbox`, `number`, `url`, `relation`.

Database IDs can be provided either inline in `_config.js` or — preferably — via
the `NOTION_DB_TASKS` / `NOTION_DB_HOMEWORK` environment variables.

> Disciplay AI uses **two databases only: Tasks and Homework.** `Subject` is a
> column on each of them (a `select`, or a `relation` if you link to a Subjects
> page), not a separate connected database.

## Environment variables

Create these on your host (Vercel → *Project Settings → **Environment Variables***,
Netlify → *Site configuration → Environment variables*, or a local `.env` file).

> **Vercel note:** use **Settings → Environment Variables** (free on the Hobby
> plan). Do **not** use the **Environments** page — that creates *custom*
> environments such as `staging`, which is a paid Pro feature this project
> does not need.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCIPLAY_PASSWORD` | ✅ | The website password, compared server-side only |
| `SESSION_SECRET` | ✅ | Long random string used to sign session cookies |
| `NOTION_TOKEN` | ✅ | Notion internal integration token (`ntn_…`) |
| `AI_API_KEY` | ✅ | Key for your AI provider (**free option: Groq**) |
| `AI_BASE_URL` | – | Defaults to `https://api.groq.com/openai/v1` |
| `AI_MODEL` | – | Defaults to `openai/gpt-oss-120b` |
| `NOTION_DB_TASKS` | – | Tasks database ID |
| `NOTION_DB_HOMEWORK` | – | Homework database ID |
| `DISCIPLAY_TIMEZONE` | – | Defaults to `Africa/Cairo` |

## Backend

The backend is plain ES-module handlers with the standard
`export default (req, res)` signature, so the **same files** run on Vercel
Functions, Netlify Functions and the bundled `server.js`.

| Endpoint | Auth | Description |
| --- | --- | --- |
| `GET /api/diagnose` | cookie | Live self-test of Notion + AI; reports the failing step without exposing secrets |
| `GET /api/health` | public | Booleans only — reports whether each secret is configured, never its value |
| `POST /api/auth` | public | `{action:'login', password}` → HttpOnly signed cookie; `{action:'logout'}` |
| `GET /api/auth?action=session` | cookie | Validates the current session |
| `GET /api/notion?action=status\|databases` | cookie | Connection test / configured databases |
| `POST /api/chat` | cookie | Runs the AI tool-calling loop against Notion |

### Real AI model (free)

Disciplay AI uses a **real large language model**, not scripted replies. Any
OpenAI-compatible provider works; the default is **Groq**, which is genuinely
free, needs no credit card, and supports the tool calling this app requires.

| Provider | `AI_BASE_URL` | `AI_MODEL` | Free? |
| --- | --- | --- | --- |
| **Groq** (default) | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | ✅ Free tier, no card |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` | ✅ Free models available |
| xAI Grok | `https://api.x.ai/v1` | `grok-3-mini` | 💳 Paid / trial credits |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 💳 Paid |

> ⚠️ **Model IDs change.** Groq retired `llama-3.3-70b-versatile` on 16 Aug 2026.
> Current tool-calling models are `openai/gpt-oss-120b` and `openai/gpt-oss-20b`.
> Check https://console.groq.com/docs/deprecations before deploying. The backend
> automatically falls back to a working model if the configured one is retired.

Get a free Groq key at **https://console.groq.com** → *API Keys* → *Create API Key*
(it starts with `gsk_`). Put it in `AI_API_KEY`. Free tier is roughly 30 requests
per minute — plenty for personal study use.

### AI tool system

The AI never writes Notion API requests. It may only select from this fixed,
schema-validated tool list, which the backend executes:

```
get_tasks    get_homework
create_task  create_homework
find_item    update_task      update_homework
delete_task  delete_homework   (require explicit user confirmation)
```

## Frontend deployment

The frontend is static — HTML, CSS and vanilla ES modules, no build step.

**Vercel (recommended)**

```bash
npm i -g vercel
vercel            # detects /api as serverless functions automatically
```
Then add every environment variable in the dashboard and redeploy.

**Netlify** — set the publish directory to the project root and point
`functions` at `api/` in `netlify.toml`.

**Self-hosted** — `node server.js` behind Nginx/Caddy with HTTPS.

## Demo mode

`js/config.js` controls it:

```js
DEMO_MODE: true,            // mock AI + mock Notion sample data
AUTO_DETECT_BACKEND: true   // auto-switches to real mode when the backend is ready
```

With auto-detection on, the app pings `/api/health` at startup and switches to
real mode as soon as the backend reports that `DISCIPLAY_PASSWORD` and
`NOTION_TOKEN` are configured. Until then a **Demo Mode** badge is shown.

**Demo password:** `disciplay`

> Prototype authentication only.
> Use server-side authentication for real security.

## Security

| Concern | How it's handled |
| --- | --- |
| Notion token | Server-side `process.env.NOTION_TOKEN` only. Never sent to, stored in, or reachable from the browser. |
| AI API key | Server-side only; the browser calls `/api/chat`, never the AI provider. |
| Password | Compared server-side with a timing-safe hash comparison. Never logged, never stored in `localStorage`, never sent to Notion. |
| Sessions | HMAC-signed, `HttpOnly`, `SameSite=Strict`, `Secure` in production — unreadable by JavaScript. Expire after 12 hours. |
| Brute force | Failed logins are delayed server-side. |
| Local storage | Chat messages, titles and UI preferences **only**. |
| Errors | Notion/AI errors are mapped to safe messages. Tokens, env vars and stack traces are never exposed. |
| XSS | All Markdown is HTML-escaped before rendering; no `innerHTML` of raw user or AI text. |
| Destructive actions | Deletion requires an explicit in-chat confirmation before the tool runs. |

## GitHub deployment considerations

- ✅ `.env` and `.env.*` are git-ignored (`.env.example` is intentionally kept).
- ✅ No file in `index.html`, `css/` or `js/` contains a credential.
- ✅ `server.js` refuses to serve `.env`, `.git`, `node_modules` or `/api/` source.
- ⚠️ If you ever commit a secret by accident, **rotate it immediately** — Notion:
  *My integrations → your integration → Secrets → Regenerate*. Rewriting git
  history is not enough; assume any pushed secret is compromised.
- Consider enabling GitHub **secret scanning** and **push protection** on the repo.

## Logo assets

| File | Use |
| --- | --- |
| `assets/logos/logo-horizontal.png` | Sidebar / wordmark contexts |
| `assets/logos/logo-mark.png` | Login screen, chat home screen |
| `assets/logos/logo-icon.png` | Header, AI avatar, app icon |
| `assets/logos/favicon.png` | Browser tab |

Original proportions are preserved throughout; the logo is never redrawn,
recoloured or distorted.

---

<div align="center"><sub>Disciplay AI — built for focused, organised study.</sub></div>
