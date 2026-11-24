# Goliath Strength Trainer App — Android

This folder is a complete installable web app (PWA). Once it's hosted at an https address,
Chrome on Android can install it to your home screen. It then opens full screen with its own
icon and works offline at the gym.

## 1. Put it online

**Vercel (you already have an account)**

Option A, from the command line, inside this folder:
```
npm i -g vercel        # skip if already installed
vercel login           # skip if already logged in
vercel                 # answer the prompts: new project, name it goliath, no framework, no build command
vercel --prod          # publishes to https://goliath-<something>.vercel.app
```

Option B, through GitHub: push this folder to a new repo, then in the Vercel dashboard choose
Add New → Project → import the repo. Framework preset: **Other**, no build command, output
directory left blank. Every push redeploys automatically.

Keep it as its own Vercel project rather than inside your other app, so the two never share
browser storage. `vercel.json` makes sure phones always fetch the newest version of the app.

**Other free hosts**

**Netlify Drop (about 2 minutes)**
1. On a computer, go to https://app.netlify.com/drop and sign up (free).
2. Drag this whole `goliath` folder onto the page.
3. Netlify gives you an address like `https://something.netlify.app`. Rename it under
   Site configuration if you like.

**GitHub Pages**
1. Create a new public repository and upload everything in this folder (keep `icons/`).
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. After a minute your app is at `https://<your-username>.github.io/<repo-name>/`.

## 2. Install it on your Android phone

1. Open the address in **Chrome**.
2. Tap **Install** on the banner, or the ⋮ menu → **Add to Home screen** → **Install**.
3. Open Goliath from your home screen. Long-press the icon for a **Gym mode** shortcut.

## Your data

- Plans, swaps and logged weights are stored **on the phone**, in the app's storage.
- Use **Back up** (under Saved plans) now and then. It saves a `.json` file to Downloads.
  **Restore** loads it on a new phone or after clearing Chrome data.
- Nothing is sent to a server. The only network requests are for the fonts.

## Updating the app

Replace `index.html` on your host, and change `VERSION` in `sw.js` (for example `goliath-v12`)
so installed copies pick up the new version the next time they open online.

## Play Store (optional)

Go to https://www.pwabuilder.com, enter your app's address, and choose **Android** to get a
package you can upload to Google Play (a Google Play developer account costs a one-time $25).

## Accounts (Supabase)

Sign-in is email and password, with one private data row per person. Until `config.js`
has keys, the app runs without accounts and keeps data on each device.

1. Create a free project at https://supabase.com.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled. For a small test
   group, turn **Confirm email** off so people can sign in straight after signing up.
4. **Authentication → URL Configuration**: set **Site URL** to `https://goliath-fit.vercel.app`
   (password-reset links return there).
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key into
   `config.js`. The anon key is meant to be public; row-level security protects the data.
   Never put the `service_role` key in this repository.
