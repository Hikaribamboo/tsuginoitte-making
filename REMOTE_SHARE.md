# Remote share with ngrok

This project can be shared from your PC while keeping the engine server local.

## Recommended (single ngrok URL)

1. Start engine server:

   cd server
   npm run dev

2. Start web server with proxy to local engine:

   cd web
   npm run dev

3. Expose web port:

   ngrok http 5173

4. Share the HTTPS ngrok URL with your friend.

In this mode, browser requests use same-origin `/engine-api`, and Vite proxies to `http://127.0.0.1:8765` on your machine.

## Optional: expose engine server directly

If you need to expose engine API directly:

1. Run: `ngrok http 8765`
2. Set `VITE_ENGINE_API_URL` to the ngrok URL for port 8765.
3. Restart web dev server.

## Notes

- Vite allows common tunnel domains (`*.ngrok-free.app`, `*.ngrok.app`, `*.ngrok.io`, `*.trycloudflare.com`).
- You can add more allowed hosts with `VITE_ALLOWED_HOSTS` in `web/.env`.
