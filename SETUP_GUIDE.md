# Facebook Supermarket Monitor — Setup Guide

This guide walks you through deploying the Worker end-to-end:

1. Create the Cloudflare D1 database and apply the schema
2. Generate a **Permanent Never-Expiring Page Access Token** via Meta Graph API
3. Configure Wrangler secrets and deploy

---

## Prerequisites

- A Cloudflare account with Workers + D1 enabled
- Wrangler CLI installed: `npm install -g wrangler`
- A Google Cloud project with the **Custom Search JSON API** enabled
- A Google Programmable Search Engine (CX ID)
- A Facebook App in **Development Mode** (or live) with:
  - A Facebook Page you administer
  - A User Access Token with `pages_manage_posts` and `pages_read_engagement`
  - The ability to generate a **long-lived Page Access Token**

---

## Step 1: Create the D1 Database & Apply Migrations

From the project root:

```bash
# 1. Authenticate with Cloudflare (if not already)
wrangler login

# 2. Create the D1 database
wrangler d1 create facebook-monitor-db
```

The command prints something like:

```
✅ Created database facebook-monitor-db in region auto
📝 You can access it with: wrangler d1 execute facebook-monitor-db --command=...
🪄 Add the following to your wrangler.toml:

[[d1_databases]]
binding = "DB"
database_name = "facebook-monitor-db"
database_id = "<UUID-DATABASE-ID>"
```

**Copy the `database_id`** and paste it into `wrangler.toml` under the `[[d1_databases]]` section, replacing the empty `database_id = ""`.

```bash
# 3. Apply the schema migration
wrangler d1 execute facebook-monitor-db --file=schema.sql
```

For local development you can run against the local D1 instance:

```bash
wrangler d1 execute facebook-monitor-db --local --file=schema.sql
```

Verify the tables were created:

```bash
wrangler d1 execute facebook-monitor-db --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expected output: `posts`, `sync_logs`.

---

## Step 2: Generate a Permanent Never-Expiring Page Access Token

Meta access tokens expire unless you exchange them through a specific flow. Follow these exact steps to obtain a **non-expiring Page Access Token**.

### 2a. Get a short-lived User Access Token

Use the Graph API Explorer or make this call (replace `APP_ID` and `APP_SECRET`):

```
GET https://graph.facebook.com/v23.0/oauth/access_token?
  grant_type=client_credentials&
  client_id={APP_ID}&
  client_secret={APP_SECRET}
```

This gives you an **app access token**. Then get a user token via the Graph API Explorer with these permissions:

- `pages_manage_posts`
- `pages_read_engagement`
- `public_profile`

Copy the short-lived **User Access Token** (valid ~1 hour).

### 2b. Exchange for a Long-Lived User Access Token

```
GET https://graph.facebook.com/v23.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id={APP_ID}&
  client_secret={APP_SECRET}&
  fb_exchange_token={SHORT_LIVED_USER_TOKEN}
```

Response:

```json
{
  "access_token": "EAAB...{LONG_LIVED_USER_TOKEN}",
  "token_type": "bearer",
  "expires_in": 5183937   // ~60 days
}
```

Save this **Long-Lived User Access Token**.

### 2c. Get the Page Access Token

Use the long-lived user token to query the accounts the user manages:

```
GET https://graph.facebook.com/v23.0/me/accounts?
  access_token={LONG_LIVED_USER_TOKEN}
```

Response (example):

```json
{
  "data": [
    {
      "name": "My Supermarket Page",
      "id": "1234567890123456",
      "access_token": "EAAB...{PAGE_ACCESS_TOKEN}",
      "tasks": ["ADVERTISER", "CONTENT_CREATOR", "MODERATOR"]
    }
  ]
}
```

Copy the `access_token` for your page. **This is a long-lived Page Access Token** (valid ~60 days).

### 2d. Make it Permanent (Never-Expiring)

To make the Page Access Token never expire, exchange it one more time:

```
GET https://graph.facebook.com/v23.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id={APP_ID}&
  client_secret={APP_SECRET}&
  fb_exchange_token={LONG_LIVED_PAGE_ACCESS_TOKEN}
```

Response:

```json
{
  "access_token": "EAAB...{PERMANENT_PAGE_ACCESS_TOKEN}",
  "token_type": "bearer",
  "expires_in": 0   // 0 = never expires
}
```

**This is the value for `FB_PAGE_ACCESS_TOKEN`.**

### 2e. Verify the token works

```
GET https://graph.facebook.com/v23.0/{FB_PAGE_ID}?
  fields=access_token&
  access_token={PERMANENT_PAGE_ACCESS_TOKEN}
```

---

## Step 3: Configure Wrangler Secrets

From the project root, set each secret interactively (values are never stored in plain text):

```bash
wrangler secret put GOOGLE_SEARCH_API_KEY
wrangler secret put GOOGLE_SEARCH_CX
wrangler secret put FB_PAGE_ID
wrangler secret put FB_PAGE_ACCESS_TOKEN
wrangler secret put DASHBOARD_AUTH_KEY
```

For each, paste the value when prompted. Example values:

| Secret | Source |
|--------|--------|
| `GOOGLE_SEARCH_API_KEY` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_SEARCH_CX` | Google Programmable Search Engine → Setup → Search engine ID |
| `FB_PAGE_ID` | The numeric ID of your Facebook Page |
| `FB_PAGE_ACCESS_TOKEN` | The permanent token from Step 2d |
| `DASHBOARD_AUTH_KEY` | Any strong password you choose (e.g. `super-secret-admin-key`) |

---

## Step 4: Deploy

```bash
# Typecheck
npm run typecheck

# Deploy to Cloudflare Workers
npm run deploy
```

After deployment, Wrangler prints a URL like:

```
https://facebook-supermarket-monitor.<your-subdomain>.workers.dev
```

---

## Step 5: Access the Admin Dashboard

Open the Worker URL with your auth key:

```
https://facebook-supermarket-monitor.<your-subdomain>.workers.dev/?key=YOUR_DASHBOARD_AUTH_KEY
```

The dashboard provides:

| Feature | Description |
|---------|-------------|
| **Stats cards** | Total posts, new today, last sync time, DB health |
| **Sync Now** | Manually triggers `/api/sync` |
| **Recent Posts** | Store badge, title, post ID, date, original/shared links, image thumbnails |
| **Sync Logs** | Last 10 run statuses with error messages |

---

## API Endpoints

All JSON endpoints require `?key=YOUR_DASHBOARD_AUTH_KEY` or `Authorization: Bearer <key>`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Dashboard statistics |
| `/api/posts` | GET | Recent posts (latest 100) |
| `/api/logs` | GET | Last 10 sync log entries |
| `/api/sync` | POST | Manual sync trigger (returns `SyncApiResponse`) |

---

## Cron Schedule

The Worker is configured with:

```
*/10 * * * *
```

This runs every 10 minutes. Each run:

1. Queries Google Custom Search with a batched `OR` query across all 10 supermarket Facebook pages
2. Filters for new posts (not already in `posts` table)
3. Shares each new post to the configured Facebook Page
4. Extracts image subattachment URLs from the shared post
5. Inserts records into `posts`
6. Writes a summary row to `sync_logs`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `wrangler d1 execute` fails | Make sure `database_id` is set in `wrangler.toml` |
| Google API returns 403 | Verify Custom Search JSON API is enabled and the key has quota |
| Facebook share returns 400 | Ensure the Page token has `pages_manage_posts` and the Page ID is correct |
| Images array is empty | The shared post may be a link-only post without subattachments; this is expected for some link shares |
| Dashboard 401 | Pass `?key=YOUR_DASHBOARD_AUTH_KEY` or use `Authorization: Bearer` header |

---

## Project Structure

```
.
├── wrangler.toml          # Worker config, cron trigger, D1 binding
├── schema.sql             # D1 SQLite schema (posts + sync_logs)
├── package.json           # Dependencies & scripts
├── tsconfig.json          # TypeScript config (strict)
├── .gitignore
├── SETUP_GUIDE.md         # This file
└── src/
    ├── index.ts           # Worker entry: scheduled + fetch handler
    ├── types.ts           # Strict TypeScript interfaces
    ├── services/
    │   ├── google.ts      # Google Custom Search client
    │   ├── facebook.ts    # Meta Graph API v23.0 client
    │   └── dashboard.ts   # HTML/CSS dashboard renderer + JSON helpers
```
