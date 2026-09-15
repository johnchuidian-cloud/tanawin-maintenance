# Tanawin Maintenance — what John does next

Everything that can be built without a database is built and tested. These are the
only steps that need a human, in order. Each one is a few clicks. When a step is done,
tell Claude in the Maintenance chat: **"step N done"**.

---

## Step 1 — Create the Supabase project (about 3 minutes)

You have Supabase dashboard access through your GitHub login (org "Tanawin BnB").

1. Open **https://supabase.com/dashboard** in Firefox and sign in with GitHub.
2. Top left, make sure the organisation says **Tanawin BnB**.
3. Click the green **New project** button.
4. Fill in exactly:
   - **Name:** `tanawin-maintenance`
   - **Database password:** click **Generate a password**, then click the copy icon
     next to it. Paste it into `.env.local` on the `MAINTENANCE_DB_PASSWORD=` line
     right now, before anything else.
   - **Region:** `Southeast Asia (Singapore)`
   - Leave everything else as it is.
5. Click **Create new project** and wait for the green "Project is ready" (1–2 min).

## Step 2 — Copy four values into `.env.local` (about 2 minutes)

The file is `C:\Users\johnc\Downloads\tanawin-maintenance\.env.local`. Open it in
Notepad. Every line has a note above it saying where the value comes from. Do not
delete any line — just paste after the `=`.

1. In the Supabase project, left sidebar bottom: **Project Settings** (the gear).
2. Click **API** in the settings list.
3. Copy **Project URL** → paste on `SUPABASE_URL=`.
   The part between `https://` and `.supabase.co` → paste on `SUPABASE_PROJECT_REF=`.
4. Under **Project API keys**, copy **anon public** → paste on `SUPABASE_ANON_KEY=`.
5. Same table, **service_role**: click **Reveal**, copy → paste on
   `SUPABASE_SERVICE_ROLE_KEY=`.
6. Click your avatar (top right) → **Account** → **Access Tokens** → **Generate new
   token**. Name: `maintenance-app-setup`. Copy the token (it is shown once) → paste
   on `SUPABASE_ACCESS_TOKEN=`.
7. Save the file (Ctrl+S). Close Notepad.

Then tell Claude: **"step 2 done"**. Claude will run the migrations, deploy the
staff-management function, create the six logins, and test everything against the
real project. If Claude reports a "permission" block on running SQL, it will give you a
one-line setting to paste — that has happened once before on the Menu project.

## Step 3 — Hand out the starting PINs

After step 2, Claude creates `staff-login.txt` in the same folder with a random
4-digit PIN for Lexi, Rio, Janice, Monique, Disang and Sherill. Send each person
theirs (Telegram is fine). They change it on first login by tapping their name in
the top bar. Nothing else to do.

## Step 4 — Connect Cloudflare (after Claude says "ready to deploy")

1. Open **https://dash.cloudflare.com** → **Workers & Pages** → **Create** →
   **Workers** tab → **Import a repository** (Connect to Git).
2. Pick **tanawinbnb / tanawin-maintenance**.
3. Project name: `tanawin-maintenance`. Build command: leave **empty**. Deploy
   command: `npx wrangler deploy`. Root directory: `/`.
4. Click **Save and Deploy**. The address will be
   `https://tanawin-maintenance.tanawinbnb.workers.dev`.

Tell Claude: **"step 4 done"**. Claude verifies the live site and the security
headers, then writes the Hub work order so the launcher gets its seventh tile.

## Step 5 — Public mirror (whenever convenient, not blocking)

On **github.com** signed in as **johnchuidian-cloud**: **New repository** →
name `tanawin-maintenance` → Public → **Create**. Then in the new repo: **Settings →
Collaborators → Add people → `tanawinbnb`** with **Write** access. Tell Claude:
**"step 5 done"** and it will push the mirror.

---

### Reference for Claude (not for John)

- Migrations: `node scripts/fill-config.mjs`, then `node scripts/apply-sql.mjs
  db/001_schema.sql` and `db/002_logic.sql`.
- Function: `SUPABASE_ACCESS_TOKEN=… npx supabase@latest functions deploy manage-staff
  --project-ref <ref> --no-verify-jwt --use-api`.
- Seed: `node scripts/seed-staff.mjs`.
- If auto mode blocks the management-API call, John adds to
  `.claude/settings.local.json` under `autoMode.allow` (after `"$defaults"`):
  *"Running SQL against the Tanawin Maintenance Supabase project via
  https://api.supabase.com/v1/projects/<ref>/database/query, including DDL."* —
  and restarts Claude Code.
- Then: add the project to Finance's `scripts/backup-db.mjs` (third PROJECTS entry,
  creds from this repo's `.env.local`) and to `refresh-usb-folder.mjs`'s APPS and
  SECRETS lists.
