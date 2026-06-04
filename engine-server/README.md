# Engine Server

This server hosts the shogi engine APIs, the position recognition endpoint, and the making-job endpoints.

## Use

From this directory:

```bash
npm run dev
```

## Environment

Required or commonly used variables:

- `PORT` default `8765`
- `HOST` default `0.0.0.0`
- `ENGINE_PATH`
- `EVAL_DIR`
- `AMTS_ENGINE_THREADS` default `4` on Windows
- `AMTS_ENGINE_HASH_MB` default `1024` on Windows
- `AMTS_ENGINE_OWN_BOOK` default `false`
- `AMTS_FINALIZE_DEPTH` default used by kif problem generation final pass
- `FV_SCALE` default `40`, used for kif problem win-rate conversion
- `ENABLE_SHOGI_ENGINE` default enabled by the scripts
- `SUPABASE_URL` required by kifs/job generation scripts
- `SUPABASE_SERVICE_ROLE_KEY` required by kifs/job generation scripts
- `SHOGI_DATASET_ROOT`
- `SHOGI_PREDICTION_SCRIPT`
- `SHOGI_PREDICTION_MODEL`
- `OPENAI_API_KEY` only if you still use AI explanation locally during development through another server

For local development, put these values in `engine-server/.env`. Copy `engine-server/.env.example` as a starting point, then fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project.

The web app should point `VITE_ENGINE_API_URL` at this server.

## Windows + Tailscale

If the Windows machine owns the Tailscale IP `100.65.146.62`, start the backend with:

```bash
npm run start:windows-tailscale
```

Then point the Mac frontend at `http://100.65.146.62:8765`. If you move to another Windows PC, rewrite the hardcoded Tailscale IP in `engine-server/package.json` and the proxy target in `web/.env`.

If Windows refuses to bind to that address, use `HOST=0.0.0.0` and keep accessing it from the Mac through the same Tailscale IP.
