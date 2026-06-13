Vercel deployment guide

Quick steps

1. Install Vercel CLI (if you want CLI deploys):

```bash
npm i -g vercel
vercel login
```

2. From the repo root, deploy:

```bash
vercel --prod
```

Recommended Vercel environment variables

- `SIMULATE` (optional): set to `false` to disable the built-in simulator and accept only hardware readings. Default `true`.
- `SIM_SPEED` (optional): acceleration factor for the simulator (ignored when `SIMULATE=false`). Default `300`.
- `DATA_DIR` (optional): path used by the server for temporary data on the runtime. On Vercel this defaults to the system temp directory; you generally don't need to set this.

Firebase / Auth notes

This project currently reads Firebase web config from `server/public/firebase-config.js` (exported `FIREBASE_CONFIG`). You have two deploy options:

A) Keep the file as-is (the SDK keys in web config are public) — no Vercel env vars required.

B) Move sensitive config to environment variables and modify `server/public/firebase-config.js` to read them from `process.env`. If you prefer this, I can update the repo to build the config from env vars.

Important: In the Firebase Console → Authentication → Sign-in method, enable:
- Google
- Email/Password

Firestore recommendation

Serverless deployments don’t have durable local disk. The app currently persists model state to a local JSON file. For production on Vercel you should use Firestore or another cloud DB to store user/state data. I can add Firestore persistence in the server if you want.

Vercel env commands (CLI)

```bash
# Add a variable for production
vercel env add SIMULATE production
# Repeat for other variables like SIM_SPEED
```

Debugging tips

- If you see a 404/NOT_FOUND after deploy, check the Vercel deployment logs (Vercel Dashboard → Deployments → View Logs). The log will show build/runtime errors and the exact function routing.
- To view runtime logs locally, run the server locally:

```bash
cd server
npm install
npm run dev
# then open http://localhost:3000
```

If you'd like, I can:
- Update `server/public/firebase-config.js` to read from env vars and add a `vercel.env.example`.
- Implement Firestore-based persistence for model state and user data.
