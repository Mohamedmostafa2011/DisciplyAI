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

## STEP 5 — Deploy to Vercel (free)

1. Go to **https://vercel.com** → sign in with GitHub.
2. **Add New → Project** → import your `disciplay-ai` repo.
3. Framework preset: **Other**. Leave build settings empty. Click **Deploy**.
4. When it finishes, go to **Settings → Environment Variables** and add:

| Name | Value |
| --- | --- |
| `DISCIPLAY_PASSWORD` | your password from 2a |
| `SESSION_SECRET` | your random string from 2b |
| `NOTION_TOKEN` | your `ntn_…` token |
| `AI_API_KEY` | your `gsk_…` Groq key |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `AI_MODEL` | `llama-3.3-70b-versatile` |
| `NOTION_DB_TASKS` | Tasks database ID |
| `NOTION_DB_HOMEWORK` | Homework database ID |
| `DISCIPLAY_TIMEZONE` | `Africa/Cairo` |
| `NODE_ENV` | `production` |

5. **Deployments → ••• → Redeploy** (env vars only apply after a redeploy).

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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Demo Mode" badge still showing | One of `DISCIPLAY_PASSWORD` / `NOTION_TOKEN` / `AI_API_KEY` is missing. Visit `/api/health` — it shows which are `false`. |
| ● Notion Connection Error | Token wrong, or you skipped the **Connections** step in Notion (STEP 3.3). |
| "could not be found" | Wrong database ID, or that database isn't shared with the integration. |
| "did not match your Notion database schema" | A column name in `api/_config.js` doesn't match Notion exactly. |
| "rate-limited" | Groq free tier is ~30 requests/minute. Wait a moment. |
| Login always fails | `DISCIPLAY_PASSWORD` not set, or you didn't redeploy after adding env vars. |

---

## Never do this

- ❌ Never paste `NOTION_TOKEN` or `AI_API_KEY` into `index.html`, `js/`, or `css/`
- ❌ Never commit a `.env` file
- ❌ Never share a screenshot showing your Vercel environment variables

If a secret ever leaks, **rotate it immediately**:
Notion → *My integrations → Secrets → Regenerate*.
Groq → *API Keys → delete and create a new one*.
