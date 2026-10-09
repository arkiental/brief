# Working on Brief

Read README.md first. Keep the interface minimal, monochrome, and free of unnecessary copy.

- `server.js`: local persistence, HTTP API, Markdown rendering, and agent-readable pages.
- `public/`: browser interface; no framework or build step.
- `test/`: Node integration tests. Run `npm test` with Node 22.12+.
- Keep runtime data, uploads, personal URLs, and `.env` out of commits.
- Maintain both the server-rendered shared page and raw Markdown endpoint; agents must be able to read a brief without JavaScript.
- Preserve Tailscale-only operation and the existing server binding unless the user requests otherwise.
- For visible UI changes, verify desktop and mobile flows in a browser.
