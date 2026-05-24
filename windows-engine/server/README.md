# Windows Engine Launcher

This directory is a Windows-friendly entrypoint for the existing `../../server` package.

It does not duplicate the server implementation. Instead, it forwards the usual scripts to the existing server package so the Windows machine can host the engine API while the Mac only runs the browser.

## Use

From this directory:

```bash
npm run dev
```

Or, if you want the web build flow used by the existing server package:

```bash
npm run dev:with-web-build
```

## Environment

Use the same environment variables as the existing server package:

- `PORT`
- `HOST`
- `ENGINE_PATH`
- `EVAL_DIR`
- `OPENAI_API_KEY`
- any other existing `server` variables

The Mac-side web app should point `VITE_ENGINE_API_URL` at the Windows machine over Tailscale.