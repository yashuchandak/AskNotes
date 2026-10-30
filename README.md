# AskNotes

A personal library for quick notes and concise AI answers. Write a note or ask a question, then keep both as cards.

## Run it

1. Install Node.js 20 or newer.
2. Run `npm install` to install the Google ID-token verification library.
3. Copy `.env.example` to `.env`, then add a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) and your Google OAuth web client ID.
4. Run `npm start` and open [http://localhost:3000](http://localhost:3000).

## Google sign-in

Create a **Web application** OAuth client in Google Auth Platform. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/auth/google` as an authorized redirect URI. Copy its client ID into `.env` as `GOOGLE_CLIENT_ID`; this sign-in flow does not need the client secret. Keep the Gemini API key and any other secrets out of the browser.

Set `APP_ORIGIN` if you use a different local address or deploy the app. It must match the origin and redirect URI configured in Google Cloud; use your HTTPS site origin in production. Google sign-in creates a server-side session cookie. Cards are scoped to the signed-in Google account. Legacy cards without an owner are kept inaccessible until an administrator explicitly assigns them; they are never automatically claimed by a signing-in account. User/session metadata is kept in `data/auth.json` and excluded from Git.

The default model is `gemini-2.5-flash-lite`. Availability and free-tier quotas depend on your Google account and project settings. The prototype stores notes and answer cards in `data/cards.json` and keeps the model API key on the server. Before a public Android launch, move card storage to a cloud database with per-user access rules.

To change the port, set `PORT`. To choose another supported model, set `GEMINI_MODEL`.
