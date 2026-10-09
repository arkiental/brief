import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp, renderMarkdown } from "../server.js";

test("posts, uploads, agent formats, conflicts, and persistence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brief-test-"));
  let server;
  async function start() {
    server = createApp({
      dataDir: dir,
      publicUrl: "https://brief.example",
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
  }
  let origin = await start();
  const request = (url, method = "GET", body) =>
    fetch(origin + url, {
      method,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  try {
    assert.equal((await request("/api/health")).status, 200);
    assert.equal(
      (
        await request("/api/posts", "POST", {
          title: "",
          markdown: "",
          tags: [],
        })
      ).status,
      400,
    );
    const form = new FormData();
    form.append(
      "file",
      new Blob(["image contents"], { type: "image/png" }),
      "reference.png",
    );
    const upload = await (
      await fetch(origin + "/api/uploads", { method: "POST", body: form })
    ).json();
    assert.match(upload.url, /^\/uploads\/[a-z0-9-]+\.png$/);
    const input = {
      title: "Build <this>",
      tags: ["Implement", "Keep scope", "Custom"],
      markdown: `## Goal\n\nA **useful** brief.\n\n![Reference](${upload.url})\n\n- [x] Done\n\n<video src="/uploads/demo.mp4"></video>`,
    };
    const createdResponse = await request("/api/posts", "POST", input);
    assert.equal(createdResponse.status, 201);
    const post = await createdResponse.json();
    const html = await (await request(`/p/${post.id}`)).text();
    assert.match(html, /Build &lt;this&gt;/);
    assert.match(html, /<strong>useful<\/strong>/);
    assert.match(html, /Raw Markdown/);
    assert.match(html, /Agent README/);
    assert.match(html, /controls/);
    const markdown = await (await request(`/p/${post.id}.md`)).text();
    assert.match(markdown, /Implement the requested change/);
    assert.match(markdown, /https:\/\/brief.example\/uploads\//);
    const negotiated = await fetch(origin + `/p/${post.id}`, {
      headers: { accept: "text/markdown" },
    });
    assert.match(negotiated.headers.get("content-type"), /text\/markdown/);
    const structured = await (await request(`/api/posts/${post.id}`)).json();
    assert.equal(structured.instructions[0].name, "Implement");
    assert.equal(structured.url, `https://brief.example/p/${post.id}`);
    assert.equal(
      (await request(`/api/posts/${post.id}`, "PUT", { ...input, version: 0 }))
        .status,
      409,
    );
    const edited = await (
      await request(`/api/posts/${post.id}`, "PUT", {
        ...input,
        title: "Updated",
        version: 1,
      })
    ).json();
    assert.equal(edited.version, 2);
    await stop();
    origin = await start();
    assert.equal(
      (await (await request(`/api/posts/${post.id}`)).json()).title,
      "Updated",
    );
    assert.equal(await (await request(upload.url)).text(), "image contents");
    assert.match(await (await request("/README.md")).text(), /Plan first/);
    assert.equal(
      (await request(`/api/posts/${post.id}`, "DELETE", { version: 1 })).status,
      409,
    );
    assert.equal(
      (await request(`/api/posts/${post.id}`, "DELETE", { version: 2 })).status,
      204,
    );
    assert.equal((await request(`/p/${post.id}`)).status, 404);
    assert.deepEqual(await (await request("/api/posts")).json(), []);
  } finally {
    await stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Markdown supports tables and code without executing pasted HTML", () => {
  const html = renderMarkdown(
    '| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>',
  );
  assert.match(html, /<table>/);
  assert.match(html, /language-js/);
  assert.doesNotMatch(html, /<script|onerror|javascript:/);
});
