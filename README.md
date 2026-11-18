# vSWAF Mission Board

Windows app for booking vSWAF missions. Pilots log in once with Discord and need the pilot role.
All missions and bookings live in the shared Google Sheet, so every pilot sees the same board.

```
Pilot's app (.exe)  →  Apps Script web app (Google)  →  Google Sheet
                         ↳ checks Discord login + role
```

## What's in here
| Path | What it is |
|---|---|
| `apps-script/` | The code that goes into the sheet's Apps Script: `Kod.gs`, `WebApp.gs`, `Index.html` |
| `main.js`, `offline.html`, `build/` | The Windows app (Electron) |
| `.github/workflows/build.yml` | Builds the .exe on GitHub and puts it on the Releases page |

---

## 1. Create the Discord app (once)
1. Go to **discord.com/developers/applications** → **New Application** → name it `vSWAF Mission Board`.
2. Open **OAuth2**. Copy the **Client ID**. Click **Reset Secret** and copy the **Client Secret**.
   Keep the secret private. Never put it on GitHub.
3. In Discord (the normal app): **User Settings → Advanced → Developer Mode: on**.
   - Right-click the vSWAF server icon → **Copy Server ID**.
   - **Server Settings → Roles** → right-click the pilot role → **Copy Role ID**.

## 2. Apps Script (once)
1. Open the sheet → **Tillägg → Apps Script**.
2. Put in the three files from `apps-script/` (Kod.gs, a script file `WebApp`, an HTML file `Index`).
3. **Projektinställningar** (gear) → **Skriptegenskaper** → add:

   | Egenskap | Värde |
   |---|---|
   | `DISCORD_CLIENT_ID` | Client ID from step 1 |
   | `DISCORD_CLIENT_SECRET` | Client Secret from step 1 |
   | `DISCORD_GUILD_ID` | Server ID |
   | `DISCORD_ROLE_ID` | Role ID |
   | `DISCORD_ROLE_NAME` | The role's name, e.g. `Pilot` (only shown on the login screen) |
   | `WEB_APP_URL` | Your web app link ending in `/exec` (add after step 4) |

4. **Distribuera** (Ny distribution the first time, otherwise Hantera distributioner → pencil → Ny version):
   Webbapp, **Kör som: Jag**, **Vem har åtkomst: Alla**. Copy the `/exec` link and add it as `WEB_APP_URL`.
5. Choose the function **checkSetup** at the top and press **Kör**. Allow the permissions.
   Open **Körningslogg**: it shows the exact link to paste in Discord.
6. Back in the Discord developer page → **OAuth2 → Redirects → Add Redirect** → paste that link → **Save Changes**.

Test: open the `/exec` link in a private browser window, log in with Discord, and the board appears.

## 3. Build the .exe on GitHub
1. Upload this folder to a **public** GitHub repo (pilots need to download from it).
2. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   name `WEB_APP_URL`, value your `/exec` link.
3. **Actions** tab → **Build Windows app** → **Run workflow**. Takes about 5 minutes.
4. The .exe files appear under **Releases**. Give pilots this link:
   `https://github.com/<your-name>/<repo>/releases/latest`

To build a new version later: raise `"version"` in `package.json`, then run the workflow again.

### Or build on your own PC
Install Node.js LTS, put your link in `config.json`, then in this folder run `npm install` and `npm run dist`.

---

## Updating
- **Missions, aircraft, bookings:** just edit the sheet. Pilots see it within 30 seconds.
- **App look or features:** paste the new code in Apps Script → Hantera distributioner → pencil → **Ny version**.
  Never use "Ny distribution" again: that makes a new link.
- **The .exe:** only needs rebuilding if the link changes.

## Security
- Nothing is shown or saved without a valid Discord login with the role.
- The role is checked again every 6 hours. Remove someone's role and they are logged out within 6 hours.
- If the app leaks or you want everyone out right away: in Apps Script run **logoutEveryone**.
  Everyone has to log in again within 10 minutes.
- New bookings are always saved under the pilot's Discord name.

## In the app
**F5** reload · **Ctrl +/−** zoom · **F11** full screen · **Log out** at the bottom left.
If Windows says "Windows protected your PC": **More info → Run anyway** (the app isn't signed).
