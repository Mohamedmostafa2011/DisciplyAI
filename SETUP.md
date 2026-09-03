# Disciplay AI — Step-by-step setup

Follow these in order. Total time: about 20 minutes.
You will never paste a secret into any code file.

---

## STEP 1 — Put the folder on GitHub

Upload the **`disciplay-ai`** folder (everything in it).

```bash
cd disciplay-ai
git init
git add .
git commit -m "Disciplay AI"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/disciplay-ai.git
git push -u origin main
```

✅ Safe to push. There is no `.env` file, and `.gitignore` blocks it forever.
The only "keys" in the repo are fake placeholders (`ntn_xxxx`, `gsk_xxxx`).

---

## STEP 2 — Get your 4 secrets

Collect these in a notepad. **Do not put them in any file yet.**

### 2a. Website password
Invent one, e.g. `MyStudy2026!`
→ this becomes `DISCIPLAY_PASSWORD`

### 2b. Session secret
Any long random string, e.g. `k39fj20dkxm29fkelq02mfkw81`
→ this becomes `SESSION_SECRET`

### 2c. Notion token *(you already have this)*
Starts with `ntn_`
→ this becomes `NOTION_TOKEN`

### 2d. FREE AI key — Groq
1. Go to **https://console.groq.com**
2. Sign in with Google/GitHub (**no credit card**)
3. Left menu → **API Keys** → **Create API Key**
4. Copy it — starts with `gsk_`
→ this becomes `AI_API_KEY`

> This is a **real AI model** (Llama 3.3 70B), not scripted answers. It genuinely
> reads your message, decides which Notion action to run, and writes the reply.

---

## STEP 3 — Get your 2 Notion database IDs

Disciplay AI uses **only two databases: Tasks and Homework.**
For **each** of them:

1. Open the database as a **full page** in Notion.
2. Look at the URL:
   `https://notion.so/myspace/`**`1a2b3c4d5e6f7890abcd1234ef567890`**`?v=999...`
   The **bold 32-character part** is the ID.
3. **IMPORTANT:** click the `•••` menu (top-right) → **Connections** →
   **Connect to** → select your Disciplay integration.
   *Skip this and Notion will say "not found" even with a perfect token.*

---

## STEP 4 — Match your Notion column names

Open **`api/_config.js`** — this is the only code file you edit.
Change the `name:` values so they match your Notion columns **exactly**
(capital letters matter).

```js
homework: {
  id: env('NOTION_DB_HOMEWORK', 'PASTE_HOMEWORK_DATABASE_ID_HERE'),
  properties: {
    title:   { name: 'Name',     type: 'title'     },  // ← your title column
    status:  { name: 'Status',   type: 'status'    },  // 'status' or 'select'
    dueDate: { name: 'Due Date', type: 'date'      },
    subject: { name: 'Subject',  type: 'select'    },
    notes:   { name: 'Notes',    type: 'rich_text' }
  },
  statusValues: { open: 'Not started', inProgress: 'In progress', done: 'Done' }
}
```

If your homework column is called `Task name` instead of `Name`, write
`name: 'Task name'`. Do the same for both databases (`tasks` and `homework`). Commit and push.

> `Subject` is just a **column** on each database, not a separate database.
> Use `type: 'select'` for a dropdown, or `type: 'relation'` if it links elsewhere.

---

## STEP 5 — Deploy to Vercel (free — no upgrade needed)

> ### ⚠️ If Vercel asked you to upgrade, you clicked the wrong menu
> In the sidebar there are two similar-looking items:
>
> | Menu item | Plan | What it is |
> | --- | --- | --- |
> | **Environments** | 💳 Pro only | Creating *extra* environments like `staging` / `QA` — **you do not need this** |
> | **Environment Variables** | ✅ **Free on Hobby** | Where you paste your secrets — **this is the one you want** |
>
> Adding environment variables to **Production**, **Preview** and **Development**
> is completely free on the Hobby plan. Only *custom* environments cost money,
> and Disciplay AI never uses one.

### 5a. Deploy

1. Go to **https://vercel.com** → sign in with GitHub.
2. **Add New → Project** → import your `disciplay-ai` repo.
3. Framework preset: **Other**. Leave all build settings empty.
4. Click **Deploy**.

### 5b. Add your secrets (the free way)

1. Open your project → **Settings** (top tab)
2. In the left sidebar click **Environment Variables** — *not* "Environments"
3. For each row below: type the **Key**, paste the **Value**, leave all three
   boxes (Production / Preview / Development) **ticked**, then click **Save**.

| Key | Value |
| --- | --- |
| `DISCIPLAY_PASSWORD` | your password from 2a |
| `SESSION_SECRET` | your random string from 2b |
| `NOTION_TOKEN` | your `ntn_…` token |
| `AI_API_KEY` | your `gsk_…` Groq key |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `AI_MODEL` | `openai/gpt-oss-120b` |

> ⚠️ Groq retired `llama-3.3-70b-versatile` in August 2026. Use
> `openai/gpt-oss-120b`. Check https://console.groq.com/docs/deprecations for changes.
| `NOTION_DB_TASKS` | Tasks database ID |
| `NOTION_DB_HOMEWORK` | Homework database ID |
| `DISCIPLAY_TIMEZONE` | `Africa/Cairo` |

*(Vercel sets `NODE_ENV=production` automatically — don't add it yourself.)*

### 5c. Redeploy

Environment variables only apply to **new** deployments:

**Deployments** tab → the top one → `•••` → **Redeploy** → confirm.

### Prefer the command line?

```bash
npm i -g vercel
vercel login
vercel link                                    # pick your project
vercel env add DISCIPLAY_PASSWORD production   # repeat for each key
vercel --prod                                  # deploy
```

---

## STEP 5 (alternative) — Other free hosts

If you'd rather not use Vercel at all, the project runs unchanged on:

**Netlify** — free env vars under *Site configuration → Environment variables*.
Add a `netlify.toml`:

```toml
[build]
  publish = "."
[functions]
  directory = "api"
  node_bundler = "esbuild"
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

**Render / Railway / Fly.io** — pick "Web Service", start command `node server.js`,
and paste the same variables into their Environment tab. All have free tiers.

**Your own PC** — see the "Running it on your own computer" section below. Free forever.

---

## STEP 6 — Test it

Open your `https://your-project.vercel.app` link.

1. The **Demo Mode** badge should be **gone** — that means the backend picked up
   all your secrets and the real AI + real Notion are live.
2. Log in with your `DISCIPLAY_PASSWORD`.
3. Sidebar should show **● Notion Connected**.
4. Try:
   - `What homework do I have this week?`
   - `Show my tasks`
   - `Add Biology homework: revise reproduction by Sunday`
   - `Move my Physics homework to Monday`
   - `Mark biology revision as done`
   - `Delete the trigonometry task` → asks you to confirm first
5. Check Notion — the changes are really there.

---

## Running it on your own computer instead

```bash
cd disciplay-ai
cp .env.example .env      # open .env, paste your real values
npm run dev               # http://localhost:3000
```
`.env` is git-ignored, so it never reaches GitHub.

---

## ⚠️ Grok vs Groq — they are DIFFERENT companies

This trips everyone up, and it causes a permanent 401:

| | Grok | Groq |
| --- | --- | --- |
| Company | xAI (Elon Musk) | Groq Inc. |
| Console | console.x.ai | console.groq.com |
| Key looks like | `xai-…` | `gsk_…` |
| Free? | Trial credits | ✅ Free tier |

A `xai-` key sent to Groq's URL → **401**. A `gsk_` key sent to xAI → **401**.

**Disciplay AI now fixes this automatically** — it reads your key's prefix and
routes to the correct provider, ignoring `AI_BASE_URL` if it disagrees. Just set
`AI_API_KEY` and the app works out the rest. You can even delete `AI_BASE_URL`
and `AI_MODEL` entirely.

---

## 🔑 Fixing a 401 "API key rejected"

**Test the key by itself, in 10 seconds.** On your own computer:

```bash
cd disciplay-ai
node check-key.mjs gsk_paste_your_key_here
```

- ✅ **"KEY IS VALID"** → the key is fine, so the problem is the *copy in Vercel*.
  Delete `AI_API_KEY` in Vercel, add it again, save, **redeploy**.
- ❌ **"401 UNAUTHORIZED"** → the key itself is dead. Make a new one at
  https://console.groq.com → **API Keys** → **Create API Key**, and verify your
  account email.

The script also prints every model your key can use, so you can confirm
`AI_MODEL` is set to one that exists.

---

## 🔎 Diagnosing "Something went wrong on the server"

Log in to the app, then open:

```
https://your-project.vercel.app/api/diagnose
```

It live-tests your Notion token, each database, your AI key, and whether the
model supports tool calling — then tells you exactly which one failed.
It only ever returns pass/fail text, never a secret.

Read `firstProblem` at the top. Common results:

| `firstProblem` | Fix |
| --- | --- |
| `AI_API_KEY set` = false | The variable didn't save, or you didn't redeploy. |
| `Notion token valid` = false | Wrong/expired `NOTION_TOKEN`. Regenerate it in Notion. |
| `Read "Homework"` → *object_not_found* | Wrong database ID, **or** you didn't share the DB with the integration (`•••` → Connections). |
| `"Homework" column names match` = false | The detail line lists the exact columns Notion has vs what `api/_config.js` expects. Copy the real names in. |
| `AI model supports tool calling` = false | Change `AI_MODEL` to `openai/gpt-oss-120b`. |
| `Configured model exists` = false | Groq retired that model. The detail line lists every model your key can use — pick one and update `AI_MODEL`. |

You can also read the raw server log: **Vercel → your project → Logs**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Demo Mode" badge still showing | One of `DISCIPLAY_PASSWORD` / `NOTION_TOKEN` / `AI_API_KEY` is missing. Visit `/api/health` — it shows which are `false`. |
| ● Notion Connection Error | Token wrong, or you skipped the **Connections** step in Notion (STEP 3.3). |
| "could not be found" | Wrong database ID, or that database isn't shared with the integration. |
| "did not match your Notion database schema" | A column name in `api/_config.js` doesn't match Notion exactly. |
| "rate-limited" | Groq free tier is ~30 requests/minute. Wait a moment. |
| Login always fails | `DISCIPLAY_PASSWORD` not set, or you didn't redeploy after adding env vars. |
| Vercel says "Upgrade to Pro" | You opened **Environments**. Go to **Settings → Environment Variables** instead — that page is free. |
| Variables saved but nothing changed | You must **redeploy**. Env vars never apply to an already-live deployment. |

---

## Never do this

- ❌ Never paste `NOTION_TOKEN` or `AI_API_KEY` into `index.html`, `js/`, or `css/`
- ❌ Never commit a `.env` file
- ❌ Never share a screenshot showing your Vercel environment variables

If a secret ever leaks, **rotate it immediately**:
Notion → *My integrations → Secrets → Regenerate*.
Groq → *API Keys → delete and create a new one*.
