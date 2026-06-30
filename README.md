# On-page feedback tool — setup

Anonymous, threaded, highlight-anchored comments on every page of a static
Netlify site. No login — viewers just type a name. A PIN-gated host mode lets
you resolve and delete comments.

Two files live in your repo (`feedback.js`, `feedback.css`); one `<script>`
line goes into Netlify. That's it — it then appears on every HTML page, including
new ones you add later.

---

## 1. Create the Supabase backend

1. Sign up at https://supabase.com and create a new (free) project.
2. Open **SQL Editor** and run:

```sql
create table comments (
  id           uuid primary key default gen_random_uuid(),
  page_path    text not null,
  parent_id    uuid references comments(id),
  author_name  text not null,
  body         text not null,
  anchor_quote   text,
  anchor_prefix  text,
  anchor_suffix  text,
  resolved     boolean not null default false,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index on comments (page_path);

alter table comments enable row level security;

create policy "read"   on comments for select using (true);
create policy "insert" on comments for insert with check (true);
create policy "update" on comments for update using (true);
```

3. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key

> The anon key is meant to be public — it's safe in client code. The RLS
> policies above are deliberately permissive (anyone can read/add/update) which
> is fine for an internal tool. There is no hard `delete` policy: "Delete" is a
> soft-delete (sets `deleted = true`) so mistakes are recoverable in the table.

---

## 2. Configure the files

Open `feedback.js` and fill in the top `CONFIG` block:

```js
const CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',
  HOST_PIN: '1234',          // change this
};
```

> Heads-up: the PIN sits in client-side JS, so a determined person could read
> it. That's an accepted trade-off for an internal tool — host mode is a
> convenience gate, not real security.

---

## 3. Commit the files

Put `feedback.js` and `feedback.css` in your repo (root is simplest, so they
serve at `/feedback.js` and `/feedback.css`). Push and let Netlify deploy.
`feedback.js` loads `feedback.css` from the same folder automatically, so keep
them together.

---

## 4. Inject it on every page (one-time)

In Netlify: **Site configuration → Build & deploy → Post processing →
Snippet injection → Add snippet.**

- Insert: **Before `</body>`**
- Snippet body:

```html
<script type="module" src="/feedback.js"></script>
```

Save. No redeploy needed — it's live immediately on every static HTML page.

---

## 5. Use it

- Flip **Feedback mode** on. Existing highlights appear; select any text to get a
  **💬 Comment** button.
- Add a comment with your name. Click a highlight (or the **☰** button) to open
  the panel and reply — replies thread under the comment.
- Flip **Host mode** on, enter the PIN, and each thread gains **Resolve**
  (greys + collapses it) and **Delete** (soft-delete).

---

## How highlight anchoring works

Each comment stores the highlighted text plus a little surrounding text. On load
the tool re-finds that text in the page (via the `dom-anchor-text-quote`
library). If you edit a page and the highlighted text changes, that comment
isn't lost — it moves into a "highlighted text changed" section at the bottom of
the panel.

## Notes & limits

- Only works on pages served **through Netlify**, not local `file://` opens.
- Comment text is rendered as plain text (never HTML), so comments can't inject
  scripts.
- This is a draft — review the code before relying on it, especially the RLS
  policies if traffic or sensitivity ever grows. To reduce spam risk later you
  can tighten the policies or add Supabase anonymous auth.
```
