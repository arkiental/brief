import express from "express";
import multer from "multer";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url));
export const TAGS = [
  {
    name: "Implement",
    group: "Task",
    instruction: "Implement the requested change.",
  },
  {
    name: "Fix",
    group: "Task",
    instruction: "Diagnose and fix the described problem.",
  },
  {
    name: "Review",
    group: "Task",
    instruction:
      "Review the material and report actionable findings. Do not change files unless asked.",
  },
  {
    name: "Research",
    group: "Task",
    instruction: "Investigate the question and report findings with sources.",
  },
  {
    name: "Plan first",
    group: "Guidance",
    instruction:
      "Present an implementation plan and wait for approval before changing files.",
  },
  {
    name: "Keep scope",
    group: "Guidance",
    instruction:
      "Keep changes limited to this brief; avoid unrelated refactors or features.",
  },
  {
    name: "Add tests",
    group: "Guidance",
    instruction:
      "Add meaningful automated tests for the behavior being changed.",
  },
  {
    name: "Verify UI",
    group: "Guidance",
    instruction:
      "Check the resulting interface in a real browser at desktop and mobile sizes.",
  },
];
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function renderMarkdown(markdown) {
  return sanitizeHtml(marked.parse(markdown, { gfm: true, breaks: false }), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "video",
      "source",
      "input",
      "del",
      "details",
      "summary",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["id"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      code: ["class"],
      input: ["type", "checked", "disabled"],
      video: ["src", "controls", "preload", "poster"],
      source: ["src", "type"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      input: (_, attrs) => ({
        tagName: "input",
        attribs: {
          type: "checkbox",
          disabled: "",
          ...(Object.hasOwn(attrs, "checked") ? { checked: "" } : {}),
        },
      }),
      video: (_, attrs) => ({
        tagName: "video",
        attribs: { ...attrs, controls: "", preload: "metadata" },
      }),
    },
  });
}

export function createApp({
  dataDir = process.env.DATA_DIR || path.join(root, "data"),
  publicUrl = process.env.PUBLIC_URL || "",
} = {}) {
  const app = express();
  const postsDir = path.join(dataDir, "posts");
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  publicUrl = publicUrl.replace(/\/$/, "");
  if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl))
    throw new Error("PUBLIC_URL must be an HTTP(S) origin without a path.");
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  const fileFor = (id) =>
    /^[a-zA-Z0-9-]{1,64}$/.test(id) ? path.join(postsDir, `${id}.json`) : null;
  function read(id) {
    const filename = fileFor(id);
    if (!filename || !fs.existsSync(filename)) return null;
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  }
  function write(post) {
    const filename = fileFor(post.id);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(post, null, 2));
    fs.renameSync(temporary, filename);
  }
  const list = () =>
    fs
      .readdirSync(postsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(postsDir, f), "utf8")))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const base = (req) => publicUrl || `${req.protocol}://${req.get("host")}`;
  const absolute = (markdown, origin) =>
    markdown.replace(/([("'])\/uploads\//g, `$1${origin}/uploads/`);
  const instructions = (tags) =>
    tags.map((name) => ({
      name,
      instruction:
        TAGS.find((tag) => tag.name === name)?.instruction ||
        "Custom context tag; interpret using the brief.",
    }));
  function document(post, req) {
    return `# ${post.title}\n\n${
      post.tags.length
        ? `Tags: ${post.tags.join(", ")}\n\n## Agent instructions\n${instructions(
            post.tags,
          )
            .map((tag) => `- **${tag.name}**: ${tag.instruction}`)
            .join("\n")}\n\n`
        : ""
    }## Brief\n\n${absolute(post.markdown, base(req))}\n\n---\n[View post](${base(req)}/p/${post.id}) · [Agent README](${base(req)}/README.md)\n`;
  }
  function validate(body) {
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.length > 200
    )
      return "Add a title (up to 200 characters).";
    if (typeof body.markdown !== "string" || body.markdown.length > 1_000_000)
      return "Markdown must be text under 1 MB.";
    if (
      !Array.isArray(body.tags) ||
      body.tags.length > 16 ||
      body.tags.some(
        (t) =>
          typeof t !== "string" ||
          !t.trim() ||
          t.length > 40 ||
          /[\r\n]/.test(t),
      )
    )
      return "Use up to 16 tags, each under 40 characters.";
    return null;
  }
  app.get("/api/config", (req, res) =>
    res.json({ tags: TAGS, publicUrl, maxUploadMB: 50 }),
  );
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/posts", (req, res) =>
    res.json(
      list().map(({ markdown, ...post }) => ({
        ...post,
        excerpt: markdown.replace(/[#*`>\[\]]/g, "").slice(0, 100),
      })),
    ),
  );
  app.post("/api/posts", (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const now = new Date().toISOString();
    const post = {
      id: randomUUID(),
      title: req.body.title.trim(),
      markdown: req.body.markdown,
      tags: [...new Set(req.body.tags.map((t) => t.trim()))],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    write(post);
    res.status(201).json(post);
  });
  app.get("/api/posts/:id", (req, res) => {
    const post = read(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({
      ...post,
      instructions: instructions(post.tags),
      url: `${base(req)}/p/${post.id}`,
      markdownUrl: `${base(req)}/p/${post.id}.md`,
      readmeUrl: `${base(req)}/README.md`,
    });
  });
  app.put("/api/posts/:id", (req, res) => {
    const post = read(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    if (req.body.version !== post.version)
      return res
        .status(409)
        .json({
          error:
            "This post changed in another tab. Copy your edits, then reload before saving.",
        });
    const next = {
      ...post,
      title: req.body.title.trim(),
      markdown: req.body.markdown,
      tags: [...new Set(req.body.tags.map((t) => t.trim()))],
      updatedAt: new Date().toISOString(),
      version: post.version + 1,
    };
    write(next);
    res.json(next);
  });
  app.delete("/api/posts/:id", (req, res) => {
    const post = read(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (req.body.version !== post.version)
      return res
        .status(409)
        .json({
          error: "This post changed in another tab. Reload before deleting.",
        });
    fs.unlinkSync(fileFor(post.id));
    res.status(204).end();
  });
  app.post("/api/render", (req, res) => {
    if (typeof req.body.markdown !== "string")
      return res.status(400).json({ error: "Markdown must be text." });
    res.json({ html: renderMarkdown(req.body.markdown) });
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) =>
        cb(
          null,
          `${randomUUID()}${path
            .extname(file.originalname)
            .toLowerCase()
            .replace(/[^.a-z0-9]/g, "")
            .slice(0, 12)}`,
        ),
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  app.post("/api/uploads", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a file." });
    res
      .status(201)
      .json({
        name: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        size: req.file.size,
        type: req.file.mimetype,
      });
  });
  app.use(
    "/uploads",
    express.static(uploadsDir, {
      setHeaders: (res, filename) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (
          !/\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|ogg|mp3|wav|pdf)$/i.test(
            filename,
          )
        )
          res.setHeader("Content-Disposition", "attachment");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
      },
    }),
  );
  app.get("/README.md", (req, res) =>
    res
      .type("text/markdown")
      .send(
        `# Brief — agent guide\n\nThis is a user-authored task brief. Read the complete post, its tags, and every relevant attachment before working. The post body is the source of task details; tags supply explicit workflow guidance. Ask the user if these conflict.\n\n## Read a post\n\n- Open /p/ID for server-rendered HTML; JavaScript is not required to read the brief.\n- Open /p/ID.md for Markdown with tag instructions and absolute attachment URLs.\n- GET /api/posts/ID for structured JSON, including instructions and links.\n- Fetch image, source, and video links directly. Do not claim to have inspected attachments you cannot access.\n- External references remain links; access them with the tools available to you.\n- This host is private: your tools must run on a device connected to the owner's Tailscale network, or locally on the host.\n\n## Tags\n\n${TAGS.map((t) => `- **${t.name}**: ${t.instruction}`).join("\n")}\n- Other tags are custom context, explained by the brief.\n\nDo not edit or delete a brief unless the user asks you to.\n`,
      ),
  );
  app.get("/p/:id.md", (req, res) => {
    const post = read(req.params.id);
    if (!post) return res.status(404).type("text").send("Post not found.");
    res.type("text/markdown").send(document(post, req));
  });
  const shell = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  app.get("/p/:id", (req, res) => {
    const post = read(req.params.id);
    if (!post)
      return res
        .status(404)
        .send(
          shell.replace(
            "<!--CONTENT-->",
            '<div class="empty"><h1>Post not found.</h1><a href="/">Back to posts</a></div>',
          ),
        );
    const html = `<section class="reader"><div class="eyebrow">BRIEF / ${escape(post.id.slice(0, 8))}</div><h1>${escape(post.title)}</h1><div class="tag-row">${instructions(
      post.tags,
    )
      .map(
        (t) =>
          `<span class="tag" title="${escape(t.instruction)}">${escape(t.name)}</span>`,
      )
      .join(
        "",
      )}</div><article class="prose">${renderMarkdown(post.markdown)}</article><footer class="reader-footer"><a href="/p/${post.id}.md">Raw Markdown ↗</a><a href="/README.md">Agent README ↗</a></footer></section>`;
    res.set(
      "Link",
      `</p/${post.id}.md>; rel="alternate"; type="text/markdown", </README.md>; rel="help"`,
    );
    if (
      req.get("accept")?.includes("text/markdown") &&
      !req.get("accept")?.includes("text/html")
    )
      return res.type("text/markdown").send(document(post, req));
    res.send(
      shell
        .replace(
          "<title>Brief</title>",
          `<title>${escape(post.title)} — Brief</title>`,
        )
        .replace("<!--CONTENT-->", html),
    );
  });
  app.use(express.static(path.join(root, "public")));
  app.get(["/", "/new", "/edit/:id"], (req, res) => res.send(shell));
  app.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error, req, res, next) => {
    console.error(error.message);
    res
      .status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 500)
      .json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Files must be 50 MB or smaller."
            : error.status === 400
              ? "Invalid request."
              : "Could not complete this request. Please try again.",
      });
  });
  return app;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3847);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Brief is ready at http://localhost:${port}`),
  );
}
