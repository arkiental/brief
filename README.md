# Brief

A small, black-and-white Markdown workspace for handing tasks to agents. Write a post, attach references, choose instruction tags, and copy its link.

## Run

Requires **Node.js 22.12+** (Node 24 recommended).

```sh
npm ci
npm start
```

Open **http://localhost:3847**. No build step, external database, CDN, account, or password is needed. The server listens on loopback by default.

## Use

1. Select **New post** and enter a title and Markdown.
2. Select **Add tag** for task and workflow instructions, or create a custom tag.
3. Paste or drop images, or use **Attach file** for images, source files, PDFs, and videos. Each file can be up to 50 MB. Images render inline; MP4/WebM/OGG uploads include a player and a direct file link. Other files are linked. Ordinary Markdown links support external references and video pages.
4. Use **Write**, **Split**, or **Preview**. On small screens, use Write or Preview.
5. **Save post** (Ctrl/Cmd+S), then **Copy link**. Saved posts can be reopened, edited, or deleted.

Edits are saved explicitly. Unsaved drafts are also cached in the current browser to recover from an accidental reload. They are not shared until saved. Concurrent saves are detected instead of silently overwriting another tab's changes.

### Tags

Choose one task tag; workflow tags can be combined. Hover a selected tag or open the tag picker for its meaning.

| Tag | Agent instruction |
| --- | --- |
| Implement | Implement the requested change. |
| Fix | Diagnose and fix the problem. |
| Review | Report actionable findings; do not edit unless asked. |
| Research | Investigate and provide sources. |
| Plan first | Present a plan and wait for approval before changing files. |
| Keep scope | Avoid unrelated refactors or features. |
| Add tests | Add meaningful tests for changed behavior. |
| Verify UI | Check the result in a browser at desktop and mobile sizes. |

Custom tags supply context; explain any specific meaning in the brief itself.

## Tailscale

Run Tailscale on the host and on the device that will read the post. Check existing Serve mappings before choosing a port:

```sh
tailscale serve status
tailscale serve --bg --https=8443 http://127.0.0.1:3847
```

The command prints your private HTTPS URL. Copy `.env.example` to `.env`, set `PUBLIC_URL` to that URL without a trailing slash, and restart Brief. **Copy link** and Markdown attachment URLs will then use the Tailscale address even when you write from localhost. Without `PUBLIC_URL`, links use the current request origin.

This uses [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), which makes the app available inside your tailnet. Use an unused HTTPS port to preserve other applications' mappings. To remove only this mapping:

```sh
tailscale serve --https=8443 off
```

The host computer must be on, Brief must be running, and the reader must have tailnet access. An agent's cloud browser cannot read this private URL unless its execution environment can reach your tailnet. A local agent on a connected computer can read it directly. No Tailscale Funnel or public website deployment is used.

## Agent access

The shared page is server-rendered: reading it does not require JavaScript.

- `/p/ID`: full HTML brief with tags, images, and links.
- `/p/ID.md`: raw Markdown, expanded tag instructions, and absolute upload URLs.
- `/api/posts/ID`: JSON with the original Markdown, tags, instructions, and URLs.
- `/README.md`: the live agent reading guide.
- `/uploads/FILE`: direct image, video, or source attachment.

`Accept: text/markdown` on `/p/ID` also returns Markdown. HTML includes alternate-format and guide links for discovery. Linked third-party resources are not downloaded automatically.

For example: “Read this brief and its Agent README, inspect the references, then implement it: [your copied link].”

## Storage and configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3847` | Local port |
| `PUBLIC_URL` | Request origin | Canonical URL for shared posts |
| `DATA_DIR` | `./data` beside `server.js` | Post and attachment storage |

Posts are separate JSON files in `data/posts`; writes use an atomic rename. Uploaded files are in `data/uploads`. Back up this directory to preserve all content. Deleting a post does not delete attachments because another post may use them. There is no automatic attachment cleanup. Browser drafts are separate from these backups.

`.env`, `data`, logs, and local runtime files are ignored by Git. The public repository contains only application code and documentation. There is deliberately no login: anyone who can reach the server can create, change, or delete posts. Rendered Markdown is sanitized so pasted HTML cannot interfere with the editor.

## Windows background startup

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

If your default Node is older, pass `-NodePath 'C:\path\to\node.exe'`. You can save that executable path in `.runtime/node-path.txt` for future launches. Logs and the process ID are written under `.runtime`.

To start Brief when you sign in, run `scripts/install-startup.ps1`. To disable this, remove **Brief.lnk** from your Windows Startup folder. To stop the app, run `scripts/stop.ps1`. Tailscale's background Serve mapping persists independently.

## Development

```sh
npm run dev
npm test
```

The app uses Express, Marked, sanitize-html, and Multer, with vanilla browser JavaScript. Tests cover post creation/editing/deletion, conflict detection, uploads, restart persistence, agent formats, and Markdown rendering. The UI is keyboard-accessible and responsive, with reduced-motion support.

Run a single server process per data directory. This is a personal workspace, not a multi-instance service.
