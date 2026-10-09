const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let config,
  posts = [],
  current = null,
  dirty = false,
  editing = false,
  saving = false,
  uploading = false,
  previewTimer,
  previewSequence = 0,
  toastTimer;
let mode = matchMedia("(max-width:740px)").matches ? "write" : "split";
const main = $("#main");
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${res.status}).`);
  }
  return res.status === 204 ? null : res.json();
}
function toast(message, long = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(
    () => $("#toast").classList.remove("visible"),
    long ? 10000 : 3000,
  );
}
function date(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
function updateList() {
  $("#post-count").textContent = String(posts.length).padStart(2, "0");
  $("#post-list").innerHTML = posts.length
    ? posts
        .map(
          (post) =>
            `<a class="post-item ${current?.id === post.id ? "active" : ""}" href="/p/${post.id}"><strong>${escape(post.title)}</strong><small>${date(post.updatedAt)}${post.tags[0] ? ` · ${escape(post.tags[0])}` : ""}</small></a>`,
        )
        .join("")
    : '<div class="no-posts">Your posts will appear here.</div>';
}
async function refreshList() {
  posts = await api("/api/posts");
  updateList();
}
function setDirty(value) {
  dirty = value;
  const el = $("#save-state");
  if (el) el.textContent = value ? "Unsaved" : current?.id ? "Saved" : "Draft";
}
function draftKey() {
  return `brief:draft:${current?.id || "new"}`;
}
function storeDraft() {
  try {
    localStorage.setItem(
      draftKey(),
      JSON.stringify({
        title: $("#title")?.value || "",
        markdown: $("#markdown")?.value || "",
        tags: current.tags,
        version: current.version,
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* Saving to the server still works without browser storage. */
  }
}
function changed() {
  setDirty(true);
  storeDraft();
}
function clearDraft(key = draftKey()) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
function leave() {
  if (saving || uploading) {
    toast("Wait for the current save or upload to finish.");
    return false;
  }
  return (
    !dirty ||
    confirm("Leave with unsaved changes? A draft will stay in this browser.")
  );
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  $("#toggle-sidebar").setAttribute("aria-expanded", "false");
  syncSidebar();
}
function syncSidebar() {
  $("#sidebar").inert =
    matchMedia("(max-width:740px)").matches &&
    !document.body.classList.contains("sidebar-open");
}
async function navigate(url, { replace = false, force = false } = {}) {
  if (!force && !leave()) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  closeSidebar();
  try {
    await route();
    window.scrollTo(0, 0);
  } catch (error) {
    toast(error.message, true);
  }
}
function actions(html) {
  $("#actions").innerHTML = html;
}
function tagMarkup(removable = false) {
  return current.tags
    .map(
      (name) =>
        `<span class="tag" title="${escape(config.tags.find((t) => t.name === name)?.instruction || "Custom tag")}">${escape(name)}${removable ? `<button class="tag-remove" data-remove-tag="${escape(name)}" aria-label="Remove ${escape(name)}">×</button>` : ""}</span>`,
    )
    .join("");
}
function refreshTags() {
  $("#selected-tags").innerHTML =
    tagMarkup(true) +
    '<button class="add-tag" id="add-tag">＋ Add tag</button>';
}
function editor() {
  editing = true;
  $("#breadcrumb").textContent = current.id ? "Edit post" : "New post";
  actions(
    '<span class="save-state" id="save-state">Draft</span><button class="button quiet" id="cancel-edit">Cancel</button><button class="button primary" id="save-post">Save post <span aria-hidden="true">↗</span></button>',
  );
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(draftKey()));
  } catch {}
  if (draft && (!current.id || draft.version === current.version)) {
    current = {
      ...current,
      title: draft.title,
      markdown: draft.markdown,
      tags: draft.tags,
    };
    dirty = true;
  }
  main.innerHTML = `<section class="editor"><div class="editor-head"><div class="eyebrow">${current.id ? "EDIT BRIEF" : "NEW BRIEF"}</div><input class="editor-title" id="title" aria-label="Post title" placeholder="Untitled post" maxlength="200" value="${escape(current.title)}"><div class="tag-row" id="selected-tags"></div></div><div class="editor-toolbar"><div class="view-tabs" aria-label="Editor view">${["write", "split", "preview"].map((m) => `<button class="view-tab" data-mode="${m}" aria-pressed="${mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div><button class="button quiet" id="attach">＋ Attach file</button></div><div class="editor-panels" data-mode="${mode}"><div class="writing-panel"><div class="pane-label">MARKDOWN</div><textarea class="markdown-input" id="markdown" aria-label="Markdown" spellcheck="false" placeholder="What should the agent do?&#10;&#10;Paste your Markdown here.&#10;Drop images or files to attach them.">${escape(current.markdown)}</textarea><div class="editor-foot"><span id="word-count"></span><span>⌘ / Ctrl + S to save</span></div></div><div class="preview-panel"><div class="pane-label">PREVIEW</div><article class="prose" id="preview"></article></div></div></section>`;
  refreshTags();
  setDirty(dirty);
  renderPreview();
  $("#title").addEventListener("input", changed);
  $("#markdown").addEventListener("input", () => {
    changed();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 180);
  });
  $("#markdown").addEventListener("paste", (event) => {
    const files = [...event.clipboardData.files];
    if (files.length) {
      event.preventDefault();
      uploadFiles(files);
    }
  });
  const area = $(".editor-panels");
  area.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      area.classList.add("drop-active");
    }
  });
  area.addEventListener("dragleave", (event) => {
    if (!area.contains(event.relatedTarget))
      area.classList.remove("drop-active");
  });
  area.addEventListener("drop", (event) => {
    event.preventDefault();
    area.classList.remove("drop-active");
    uploadFiles([...event.dataTransfer.files]);
  });
  if (!current.id && !current.title) $("#title").focus();
}
async function renderPreview() {
  const field = $("#markdown");
  if (!field) return;
  const text = field.value;
  const seq = ++previewSequence;
  $("#word-count").textContent =
    `${text.trim() ? text.trim().split(/\s+/).length : 0} words`;
  try {
    const result = await api("/api/render", {
      method: "POST",
      body: JSON.stringify({ markdown: text }),
    });
    if (seq === previewSequence && $("#preview"))
      $("#preview").innerHTML =
        result.html ||
        '<div class="preview-placeholder">Your brief, as the agent will see it.</div>';
  } catch (error) {
    if ($("#preview"))
      $("#preview").innerHTML =
        `<p class="error-inline">${escape(error.message)}</p>`;
  }
}
async function save() {
  if (saving || uploading) return;
  const title = $("#title").value.trim();
  if (!title) {
    $("#title").focus();
    toast("Add a title first.");
    return;
  }
  saving = true;
  $("#save-post").disabled = true;
  main.inert = true;
  const key = draftKey();
  try {
    current = await api(
      current.id ? `/api/posts/${current.id}` : "/api/posts",
      {
        method: current.id ? "PUT" : "POST",
        body: JSON.stringify({
          title,
          markdown: $("#markdown").value,
          tags: current.tags,
          version: current.version,
        }),
      },
    );
    clearDraft(key);
    setDirty(false);
    await refreshList();
    await navigate(`/p/${current.id}`, { replace: true, force: true });
    toast("Post saved.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    saving = false;
    main.inert = false;
    if ($("#save-post")) $("#save-post").disabled = false;
  }
}
async function reader(post) {
  editing = false;
  current = post;
  $("#breadcrumb").textContent = "Posts / " + post.title;
  document.title = `${post.title} — Brief`;
  actions(
    '<button class="button quiet" id="delete-post" aria-label="Delete post">Delete</button><button class="button" id="edit-post">Edit</button><button class="button primary" id="copy-link">Copy link <span aria-hidden="true">↗</span></button>',
  );
  const { html } = await api("/api/render", {
    method: "POST",
    body: JSON.stringify({ markdown: post.markdown }),
  });
  main.innerHTML = `<section class="reader"><div class="eyebrow">BRIEF / ${date(post.updatedAt).toUpperCase()}</div><h1>${escape(post.title)}</h1><div class="tag-row">${tagMarkup()}</div><article class="prose">${html}</article><footer class="reader-footer"><a href="/p/${post.id}.md" target="_blank">Raw Markdown ↗</a><a href="/README.md" target="_blank">Agent README ↗</a></footer></section>`;
  updateList();
}
async function route() {
  ++previewSequence;
  clearTimeout(previewTimer);
  dirty = false;
  editing = false;
  const pathname = location.pathname;
  if (pathname === "/new") {
    current = { title: "", markdown: "", tags: [], version: undefined };
    editor();
    updateList();
    return;
  }
  const match = pathname.match(/^\/(p|edit)\/([^/]+)$/);
  if (match) {
    try {
      current = await api(`/api/posts/${match[2]}`);
    } catch (error) {
      actions("");
      main.innerHTML = `<div class="empty"><h1>Post unavailable.</h1><p>${escape(error.message)}</p><a href="/" class="button">Back to posts</a></div>`;
      return;
    }
    if (match[1] === "edit") editor();
    else await reader(current);
    updateList();
    return;
  }
  current = null;
  updateList();
  document.title = "Brief";
  if (posts.length) {
    await navigate(`/p/${posts[0].id}`, { replace: true, force: true });
    return;
  }
  $("#breadcrumb").textContent = "Workspace";
  actions("");
  main.innerHTML =
    '<section class="empty"><div class="empty-mark" aria-hidden="true">[↗]</div><h1>A place for your next brief.</h1><p>Write it. Add context. Send it to your agent.</p><button class="button primary" id="first-post">New post <span aria-hidden="true">＋</span></button></section>';
}
function showTags() {
  $("#tag-options").innerHTML = ["Task", "Guidance"]
    .map(
      (group) =>
        `<div class="tag-group-label">${group.toUpperCase()}</div>${config.tags
          .filter((t) => t.group === group)
          .map(
            (t) =>
              `<label class="tag-option"><input type="checkbox" data-tag="${escape(t.name)}" ${current.tags.includes(t.name) ? "checked" : ""}><span><strong>${escape(t.name)}</strong><small>${escape(t.instruction)}</small></span></label>`,
          )
          .join("")}`,
    )
    .join("");
  $("#tag-dialog").showModal();
}
function addTag(name) {
  name = name.trim();
  if (!name || current.tags.includes(name)) return;
  if (current.tags.length >= 16) return toast("Use up to 16 tags.");
  if (config.tags.find((t) => t.name === name)?.group === "Task")
    current.tags = current.tags.filter(
      (tag) => config.tags.find((t) => t.name === tag)?.group !== "Task",
    );
  current.tags.push(name);
  refreshTags();
  changed();
}
async function uploadFiles(files) {
  if (!editing || !files.length || uploading || saving) return;
  const editorId = current.id;
  const field = $("#markdown");
  uploading = true;
  $("#attach").disabled = true;
  $("#save-post").disabled = true;
  try {
    for (const file of files) {
      if (file.size > config.maxUploadMB * 1024 * 1024) {
        toast(`${file.name}: maximum file size is 50 MB.`, true);
        continue;
      }
      const data = new FormData();
      data.append("file", file);
      toast(`Uploading ${file.name}…`);
      const result = await api("/api/uploads", { method: "POST", body: data });
      if (!editing || current.id !== editorId || $("#markdown") !== field)
        return;
      const name = result.name.replace(/[\[\]<>\r\n]/g, "").replace(/\\/g, "/");
      const ext = result.url.split(".").pop();
      const snippet = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "avif",
        "svg",
      ].includes(ext)
        ? `![${name}](${result.url})`
        : ["mp4", "webm", "ogg"].includes(ext)
          ? `<video controls src="${result.url}"></video>\n[${name}](${result.url})`
          : `[${name}](${result.url})`;
      field.setRangeText(
        `\n${snippet}\n`,
        field.selectionStart,
        field.selectionEnd,
        "end",
      );
      changed();
      renderPreview();
    }
    toast("Attached. Save the post to keep your changes.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    uploading = false;
    if ($("#attach")) $("#attach").disabled = false;
    if ($("#save-post")) $("#save-post").disabled = false;
    $("#file-picker").value = "";
  }
}
async function copyLink() {
  const link = `${config.publicUrl || location.origin}/p/${current.id}`;
  try {
    if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(link);
    else {
      const field = document.createElement("textarea");
      field.value = link;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    toast("Link copied.");
  } catch {
    prompt("Copy this link:", link);
  }
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button,a");
  if (!target) return;
  const action = target.id;
  try {
    if (["new-post", "first-post"].includes(action)) await navigate("/new");
    if (action === "save-post") await save();
    if (action === "edit-post") await navigate(`/edit/${current.id}`);
    if (action === "cancel-edit")
      await navigate(current.id ? `/p/${current.id}` : "/");
    if (action === "copy-link") await copyLink();
    if (action === "add-tag") showTags();
    if (action === "close-tags") $("#tag-dialog").close();
    if (action === "attach") $("#file-picker").click();
    if (action === "toggle-sidebar") {
      const opened = document.body.classList.toggle("sidebar-open");
      target.setAttribute("aria-expanded", String(opened));
      syncSidebar();
    }
    if (action === "sidebar-scrim") closeSidebar();
    if (
      action === "delete-post" &&
      confirm(`Delete “${current.title}”? This cannot be undone.`)
    ) {
      await api(`/api/posts/${current.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: current.version }),
      });
      clearDraft();
      await refreshList();
      await navigate("/", { replace: true, force: true });
      toast("Post deleted.");
    }
    if (target.dataset.removeTag) {
      current.tags = current.tags.filter(
        (tag) => tag !== target.dataset.removeTag,
      );
      refreshTags();
      changed();
    }
    if (target.dataset.mode) {
      mode = target.dataset.mode;
      $(".editor-panels").dataset.mode = mode;
      document
        .querySelectorAll(".view-tab")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.mode === mode),
          ),
        );
    }
    if (
      target.matches("a") &&
      !target.target &&
      (target.classList.contains("post-item") ||
        target.classList.contains("brand") ||
        target.getAttribute("href") === "/")
    ) {
      event.preventDefault();
      await navigate(target.getAttribute("href"));
    }
  } catch (error) {
    toast(error.message, true);
  }
});
$("#tag-options").addEventListener("change", (event) => {
  const tag = event.target.dataset.tag;
  if (!tag) return;
  if (event.target.checked) addTag(tag);
  else {
    current.tags = current.tags.filter((t) => t !== tag);
    refreshTags();
    changed();
  }
  document
    .querySelectorAll("[data-tag]")
    .forEach(
      (input) => (input.checked = current.tags.includes(input.dataset.tag)),
    );
});
$("#custom-tag-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addTag($("#custom-tag").value);
  $("#custom-tag").value = "";
  $("#tag-dialog").close();
});
$("#file-picker").addEventListener("change", (event) =>
  uploadFiles([...event.target.files]),
);
window.addEventListener("beforeunload", (event) => {
  if (dirty || saving || uploading) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("popstate", () => {
  if (dirty) storeDraft();
  route().catch((error) => toast(error.message, true));
});
document.addEventListener("keydown", (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s" &&
    editing
  ) {
    event.preventDefault();
    save();
  }
  if (event.key === "Escape") closeSidebar();
});
matchMedia("(max-width:740px)").addEventListener("change", syncSidebar);
syncSidebar();
try {
  config = await api("/api/config");
  await refreshList();
  await route();
} catch (error) {
  toast(`Unable to connect. ${error.message}`, true);
}
