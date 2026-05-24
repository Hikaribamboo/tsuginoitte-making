# Remote share with Tailscale

This project can be used from a Mac while the engine server runs on a Windows PC.

## Recommended setup

1. Install and sign in to Tailscale on both machines.
2. On Windows, start the engine server from the launcher:

   cd windows-engine/server
   npm run dev

3. On the Mac, point the web app at the Windows machine:

   set `VITE_ENGINE_API_URL=http://<windows-tailscale-name-or-ip>:8765`

4. Start the web app on the Mac:

   cd web
   npm run dev

## Notes

- The web app already calls the engine through `/api/evaluate`, `/api/analyze`, `/api/analyze/stop`, and `/api/generate-explanations`.
- The same engine API also serves making-job endpoints such as `/api/making-jobs` and `/api/making-options`.
- If you want HTTPS in front of the Windows server, add a TLS reverse proxy or use Tailscale Serve.
