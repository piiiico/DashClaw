# DashClaw in Claude Desktop — install guide

Gets the DashClaw **skills + the 23 governance tools** (`dashclaw_guard`, `dashclaw_record`, …) into Claude Desktop, using a **remote** connection to your deployed instance. No local Node process runs, so nothing crashes — it works in both chat and Cowork.

## TL;DR
1. Build the plugin zip.
2. Set ONE environment variable: `DASHCLAW_API_KEY`.
3. Upload the zip in Customize → Plugins.
4. Uninstall the old `.mcpb` extension if you have one.
5. Fully restart Claude, test.

---

## 1. Build the plugin

From the repo root:

```bash
node scripts/build-desktop-plugin.mjs --url https://YOUR-INSTANCE.vercel.app
```

`--url` is your deployed DashClaw URL (e.g. `https://my-dashclaw.vercel.app`). Output: **`dist/dashclaw-plugin.zip`**.

## 2. Set the API key — ONE env var, not a file

The plugin reads **`DASHCLAW_API_KEY`** from your environment. It must be a key your **deployed** instance accepts (the `DASHCLAW_API_KEY` you set in Vercel, or one minted in that instance's `/api-keys` page).

> **It is NOT a folder or a file you edit.** The plugin does **not** read the repo's `.env` (`C:\Projects\DashClaw\.env`) — editing that does nothing.

**Windows (PowerShell):**

```powershell
setx DASHCLAW_API_KEY "oc_live_your_real_key"
```

- `setx` writes a persistent **user** environment variable.
- It only affects programs started **after** you run it → you must **fully quit and relaunch Claude** (close it from the system tray too, not just the window). A window reload is not enough.

**Confirm the key works first (no Claude involved):**

```powershell
curl.exe https://YOUR-INSTANCE.vercel.app/api/health
curl.exe -H "x-api-key: oc_live_your_real_key" https://YOUR-INSTANCE.vercel.app/api/policies
```

- `/api/health` → `status: healthy` means the instance is up.
- `/api/policies` returns JSON → your key is valid. `401` → wrong/expired key.

## 3. Upload the plugin

In Claude Desktop:

**Customize** (left sidebar) → **Personal plugins** → **`+`** → **Create plugin** → **Upload plugin** → select **`dist/dashclaw-plugin.zip`**.

## 4. Remove the old `.mcpb` extension (important)

If you ever installed the `.mcpb`:

**Settings → Extensions →** if **`dashclaw`** is listed, **Uninstall** it.

It runs on Desktop's bundled Node (crashes) and collides with this plugin (same name `dashclaw`). Remove it so there's exactly one.

## 5. Restart + test

Fully quit and relaunch Claude. In a new chat:

```
list my dashclaw policies
```

Returns your policies → done. The governance tools are live.

---

## If it still doesn't work

- **Tools appear but every call 401s** → the key is wrong, or `${DASHCLAW_API_KEY}` didn't resolve in the environment Claude handed the connector. Re-run the `curl` test to confirm the key; redo `setx` + a full restart. **Guaranteed fallback — bake the key into the plugin:**

  ```bash
  node scripts/build-desktop-plugin.mjs --url https://YOUR-INSTANCE.vercel.app --key oc_live_your_real_key
  ```

  then re-upload. (Personal use only — the key now lives in the plugin file; never commit or share that build.)

- **Tools don't appear at all** → the env var resolved empty and Claude skipped the server. Set the key (step 2) and fully restart.
- **Can't reach the instance** → confirm `--url` is your real, live instance (`curl.exe https://YOUR-INSTANCE.vercel.app/api/health` returns `status: healthy`).

## Why remote, not the `.mcpb` bundle

Claude Desktop's main chat runs local MCP servers on its **bundled Node**, where the DashClaw stdio server exits right after `initialize`. A **remote** server (`type: http` → your `/api/mcp`) has no local process to crash, so it works in chat and Cowork alike — reusing the endpoint your deployment already serves. (The `.mcpb`/stdio path only runs cleanly where *system* Node launches it: Claude Code and Cowork.)
