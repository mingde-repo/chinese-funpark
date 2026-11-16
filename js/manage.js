"use strict";

// ⚙ 管理 dialog: upload, replace, edit and delete game pages in Supabase, through its REST APIs
// (no SDK). The files go to the Storage bucket BUCKET under a new name for every version
// (<key>_v<stamp>.html, <key>_v<stamp>.<ext>), and the list (with the current file names) to the
// table TABLE. So no browser or CDN can ever serve an old version. A teacher signs in with an email and password (Supabase Auth); the
// policies in Supabase let anyone read and only signed-in users write. Changes are live at once.
// Talks to main.js only through the "pages-changed" DOM event.
(() => {
  // The Supabase project is set once, in the <meta> tags at the top of index.html.
  function metaContent(name) {
    const node = document.querySelector(`meta[name="${name}"]`);
    return node ? node.content.trim() : "";
  }
  const SUPABASE_URL = metaContent("mingde-supabase-url").replace(/\/+$/, "");
  const SUPABASE_KEY = metaContent("mingde-supabase-anon-key");
  const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);
  const BUCKET = "games";
  const TABLE = "pages";
  const FILE_BASE = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  // Browsers (and the CDN) may keep a file this long. A file never changes under its name, so this
  // only matters for a deleted game: devices that played it may keep their copy this long.
  const CACHE_SECONDS = 30 * 24 * 60 * 60;
  const HTML_TYPE = "text/html;charset=utf-8";
  const MAX_UPLOAD_MB = 50;
  const LARGE_UPLOAD_MB = 25;
  const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const TITLE_MAX = 40;
  const DESC_MAX = 200;
  const AUTHOR_MAX = 40;
  const TEXTBOOK_MAX = 40;
  const VOLUME_MAX = 20;
  const LESSON_MAX = 999;
  const CN_DIGITS = "零一二三四五六七八九";
  // A file name in the bucket: the key, "_v", the save time (14 digits, UTC) and the extension.
  // Keys can't contain "_", so "<key>_" starts the names of that game's files only. The save
  // time (not a counter) keeps names unique even when a deleted key is uploaded again.
  const VERSIONED_NAME = /^([a-z0-9][a-z0-9-]{0,39})_v(\d{14})\.(html|png|jpg|webp)$/;
  // Optional thumbnail picture, saved as <key>_v<stamp>.<ext> in the bucket.
  const THUMB_EXTS = ["png", "jpg", "webp"];
  const THUMB_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
  const THUMB_MAX_MB = 1;
  // Thumbnails made from the pictures embedded in a game file: 4:3, at most this many choices.
  const THUMB_WIDTH = 640;
  const THUMB_HEIGHT = 480;
  const THUMB_CHOICES_MAX = 6;
  const THUMB_SOURCES_MAX = 20; // biggest embedded pictures looked at
  const THUMB_SOURCE_MIN_B64 = 4000; // smaller data: URLs are icons
  const THUMB_SOURCE_MIN_PX = 160; // pictures narrower or shorter than this are skipped
  // A picture embedded as a data: URL. JSON and JS strings may write "\/" for "/".
  const DATA_IMAGE_RE = /data:image\\?\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/\\]+={0,2})/g;
  const SESSION_STORAGE_KEY = "mingde.supabaseSession";
  // Where the GitHub token was remembered before. Removed on load, so it doesn't linger.
  const OLD_TOKEN_STORAGE_KEY = "mingde.githubToken";
  // Refresh the sign-in this many seconds before it expires.
  const REFRESH_MARGIN_S = 60;
  const MB = 1024 * 1024;
  const NOT_CONFIGURED =
    "网站还没有连接 Supabase（见 README）/ The site isn't connected to Supabase yet (see README).";
  const FILES_NOT_DELETED =
    "文件没有被删除（请检查 Supabase 存储的删除权限）/ The files were not deleted. Check the storage delete policy in Supabase.";
  const ROW_NOT_SAVED =
    "列表没有更新（请检查 Supabase 表 pages 的权限）/ The list was not updated. Check the policies of the pages table in Supabase.";
  const PAGE_GONE = "这个页面已不存在 / This page no longer exists.";

  // Keep our own reference, taken before any game page loads, so a page in the iframe
  // can't replace fetch and see the sign-in.
  const nativeFetch = window.fetch.bind(window);

  const byId = (id) => document.getElementById(id);
  const dialog = byId("manage-dialog");
  const manageBtn = byId("manage-btn");
  const closeBtn = byId("manage-close");
  const signinState = byId("signin-state");
  const signinForm = byId("signin-form");
  const signinEmail = byId("signin-email");
  const signinPassword = byId("signin-password");
  const signinOut = byId("signin-out");
  const signinOutRow = byId("signin-out-row");
  const signinRemember = byId("signin-remember");
  const uploadForm = byId("upload-form");
  const uploadFile = byId("upload-file");
  const uploadNote = byId("upload-note");
  const uploadKey = byId("upload-key");
  const uploadTitle = byId("upload-title");
  const uploadDesc = byId("upload-desc");
  const uploadTextbook = byId("upload-textbook");
  const uploadVolume = byId("upload-volume");
  const uploadLesson = byId("upload-lesson");
  const uploadAuthor = byId("upload-author");
  const uploadThumb = byId("upload-thumb");
  const uploadSubmit = uploadForm.querySelector('button[type="submit"]');
  const listNote = byId("list-note");
  const pageList = byId("page-list");
  const editForm = byId("edit-form");
  const editHeading = byId("edit-heading");
  const editTitle = byId("edit-title");
  const editDesc = byId("edit-desc");
  const editTextbook = byId("edit-textbook");
  const editVolume = byId("edit-volume");
  const editLesson = byId("edit-lesson");
  const editAuthor = byId("edit-author");
  const editThumb = byId("edit-thumb");
  const editThumbRemove = byId("edit-thumb-remove");
  const editThumbRemoveRow = byId("edit-thumb-remove-row");
  const editFromGame = byId("edit-thumb-from-game");
  const editCancel = byId("edit-cancel");
  const statusEl = byId("manage-status");

  // The fields of each form, by entry property (in the order they are saved).
  const uploadFields = {
    title: uploadTitle,
    description: uploadDesc,
    textbook: uploadTextbook,
    volume: uploadVolume,
    lesson: uploadLesson,
    author: uploadAuthor,
  };
  const editFields = {
    title: editTitle,
    description: editDesc,
    textbook: editTextbook,
    volume: editVolume,
    lesson: editLesson,
    author: editAuthor,
  };

  // Keys that uploaded pages may not use: the built-in games, "contents" and "manage".
  const RESERVED_KEYS = new Set(["contents", "manage"]);
  document.querySelectorAll(".nav-btn[data-builtin]").forEach((btn) => {
    RESERVED_KEYS.add(btn.dataset.page);
  });

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  // The sign-in: { access_token, refresh_token, expires_at (seconds), email }, or null.
  let session = loadSavedSession();
  // Keep the sign-in in localStorage ("Remember on this device"), or only in memory.
  let rememberSession = Boolean(session);
  let list = [];
  let busy = false;
  let editingKey = null;

  // ---------- small helpers ----------

  function loadSavedSession() {
    try {
      window.localStorage.removeItem(OLD_TOKEN_STORAGE_KEY);
      const saved = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "null");
      return saved && typeof saved.refresh_token === "string" ? saved : null;
    } catch {
      return null;
    }
  }

  function saveSession(value) {
    try {
      if (value) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Storage blocked (private window, file:// in some browsers): keep it in memory only.
    }
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  // "20261116090000": the version part of new file names.
  function versionStamp() {
    return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  }

  // A file name in the bucket for this game, version and extension.
  function versionedName(key, stamp, ext) {
    return `${key}_v${stamp}.${ext}`;
  }

  // `name` if it is a file name of this game with one of `exts`, else "".
  function cleanFileName(name, key, exts) {
    const match = typeof name === "string" ? VERSIONED_NAME.exec(name) : null;
    return match && match[1] === key && exts.includes(match[3]) ? name : "";
  }

  // "png", "jpg" or "webp" from the file name ("" if it isn't one of those).
  function thumbExt(file) {
    const match = /\.(png|jpe?g|webp)$/i.exec(file.name);
    if (!match) return "";
    const ext = match[1].toLowerCase();
    return ext === "jpeg" ? "jpg" : ext;
  }

  function cleanText(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  // A lesson is a whole number 1–LESSON_MAX, or null when not set.
  function cleanLesson(value) {
    return Number.isInteger(value) && value >= 1 && value <= LESSON_MAX ? value : null;
  }

  // 3 → "三", 12 → "十二", 25 → "二十五"; 100 and up stay as digits.
  function chineseNumber(n) {
    if (n < 10) return CN_DIGITS[n];
    if (n < 100) {
      const tens = Math.floor(n / 10);
      const ones = n % 10;
      return `${tens > 1 ? CN_DIGITS[tens] : ""}十${ones ? CN_DIGITS[ones] : ""}`;
    }
    return String(n);
  }

  function lessonLabel(lesson) {
    return lesson === null ? "" : `第${chineseNumber(lesson)}课`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }

  function setBusy(value) {
    busy = value;
    dialog.setAttribute("aria-busy", String(value));
    dialog.querySelectorAll("button, input, textarea").forEach((control) => {
      if (control !== closeBtn) control.disabled = value;
    });
    updateUploadButton();
  }

  // Upload is enabled only when signed in and the required fields (file, key, title) are filled.
  // The full checks still run on submit.
  function updateUploadButton() {
    let missing = "";
    if (!CONFIGURED) {
      missing = NOT_CONFIGURED;
    } else if (!session) {
      missing = "请先在 ① 登录 / Sign in in section ① first.";
    } else if (!uploadFile.files[0]) {
      missing = "请选择文件 / Choose a file.";
    } else if (!uploadKey.value.trim()) {
      missing = "请填写键 / Enter a key.";
    } else if (!uploadTitle.value.trim()) {
      missing = "请填写标题 / Enter a title.";
    }
    uploadSubmit.disabled = busy || Boolean(missing);
    uploadSubmit.title = missing;
  }

  // ---------- the list of uploaded pages ----------

  function cleanEntries(raw) {
    const result = [];
    if (!Array.isArray(raw)) return result;
    const seen = new Set();
    raw.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const { key, title } = entry;
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) return;
      if (RESERVED_KEYS.has(key) || seen.has(key)) return;
      if (typeof title !== "string" || !title.trim() || title.length > TITLE_MAX) return;
      // The game's current HTML file. A row without one can't be opened, so it isn't listed.
      const file = cleanFileName(entry.file, key, ["html"]);
      if (!file) return;
      seen.add(key);
      result.push({
        key,
        file,
        title: title.trim(),
        description:
          typeof entry.description === "string" ? entry.description.slice(0, DESC_MAX) : "",
        // Older entries have a single "book" text instead (or nothing): it becomes the textbook,
        // and the next commit saves it that way.
        textbook: cleanText(
          Object.prototype.hasOwnProperty.call(entry, "textbook") ? entry.textbook : entry.book,
          TEXTBOOK_MAX,
        ),
        volume: cleanText(entry.volume, VOLUME_MAX),
        lesson: cleanLesson(entry.lesson),
        author: cleanText(entry.author, AUTHOR_MAX),
        // The picture's file name, or "" when the game has no picture.
        thumb: cleanFileName(entry.thumb, key, THUMB_EXTS),
        updated: typeof entry.updated === "string" ? entry.updated : "",
      });
    });
    return result;
  }

  // Tell main.js to redraw the contents page.
  function notifyPages(status) {
    const detail = { pages: list.map((page) => ({ ...page })) };
    if (status !== undefined) detail.status = status;
    document.dispatchEvent(new CustomEvent("pages-changed", { detail }));
  }

  // ---------- Supabase REST API ----------

  // Supabase puts the message in one of several fields. Storage can answer HTTP 400 with the
  // real status in "statusCode" (e.g. "403" for a policy, "413" for a file that is too big).
  async function apiError(res) {
    let status = res.status;
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.msg || body.message || body.error_description || body.error || message;
      const inner = Number(body.statusCode);
      if (status === 400 && inner >= 400 && inner < 600) status = inner;
    } catch {
      // Not JSON: keep the status text.
    }
    return new ApiError(status, String(message));
  }

  async function readJson(res) {
    if (!res.ok) throw await apiError(res);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Supabase Auth: grant "password" ({ email, password }) or "refresh_token" ({ refresh_token }).
  async function authRequest(grant, body) {
    const res = await nativeFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return readJson(res);
  }

  function keepSession(data) {
    const user = data.user || {};
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      email: user.email || (session ? session.email : ""),
    };
    saveSession(rememberSession ? session : null);
  }

  function dropSession() {
    session = null;
    saveSession(null);
    renderSignInState();
    updateUploadButton();
  }

  // The access token, refreshed first when it is about to expire. "" when signed out.
  async function accessToken() {
    if (!session) return "";
    if (session.expires_at - REFRESH_MARGIN_S > Date.now() / 1000) return session.access_token;
    try {
      keepSession(await authRequest("refresh_token", { refresh_token: session.refresh_token }));
    } catch (err) {
      // The refresh token was revoked or has expired: the teacher has to sign in again.
      if (err instanceof ApiError && err.status < 500) {
        dropSession();
        throw new ApiError(401, err.message);
      }
      throw err;
    }
    return session.access_token;
  }

  // One REST call. `json` is sent as JSON, `body` as it is (a File). Signed out, the call has
  // only the anon key, which the policies allow to read but not to write.
  async function call(path, { method = "GET", headers = {}, json, body } = {}) {
    const init = { method, headers: { apikey: SUPABASE_KEY, ...headers }, cache: "no-store" };
    const bearer = await accessToken();
    if (bearer) init.headers.Authorization = `Bearer ${bearer}`;
    if (json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    return readJson(await nativeFetch(`${SUPABASE_URL}${path}`, init));
  }

  function rowFilter(key) {
    return `key=eq.${encodeURIComponent(key)}`;
  }

  async function fetchList() {
    return cleanEntries(await call(`/rest/v1/${TABLE}?select=*&order=key`));
  }

  // One entry, or null when there is none.
  async function fetchRow(key) {
    const rows = cleanEntries(await call(`/rest/v1/${TABLE}?select=*&${rowFilter(key)}`));
    return rows[0] || null;
  }

  // Upload one new file to the bucket. Names are never reused, so an existing file is never
  // overwritten: if two teachers save the same game in the same second, the second one gets a
  // 409 ("please try again") instead of silently replacing the first one's file.
  async function putFile(name, file, type) {
    return call(`/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "Content-Type": type,
        "x-upsert": "false",
        "cache-control": `max-age=${CACHE_SECONDS}`,
      },
      body: file,
    });
  }

  // All of this game's files in the bucket, every version ("<key>_…").
  async function filesOf(key) {
    const prefix = `${key}_`;
    const found = await call(`/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      json: { prefix: "", search: prefix, limit: 1000 },
    });
    return (Array.isArray(found) ? found : [])
      .map((obj) => obj.name)
      .filter((name) => typeof name === "string" && name.startsWith(prefix));
  }

  // Delete files from the bucket, and make sure they are gone. When a storage policy blocks the
  // delete, Supabase still answers 200 and just lists nothing. So the names missing from the
  // answer are looked up: files that were already gone (a retry) are fine, files still there fail.
  async function removeFiles(key, names) {
    if (names.length === 0) return;
    const removed = await call(`/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      json: { prefixes: names },
    });
    const gone = new Set((Array.isArray(removed) ? removed : []).map((obj) => obj.name));
    const unsure = names.filter((name) => !gone.has(name));
    if (unsure.length === 0) return;
    const present = new Set(await filesOf(key));
    if (unsure.some((name) => present.has(name))) throw new Error(FILES_NOT_DELETED);
  }

  function describeError(err) {
    if (err instanceof ApiError) {
      switch (err.status) {
        case 401:
          return `请重新登录 / Signed out, or the sign-in has expired. Sign in again. (${err.message})`;
        case 403:
          return `没有权限，请检查 Supabase 的权限设置 / Not allowed: check the policies in Supabase. (${err.message})`;
        case 404:
          return `找不到，请检查 Supabase 的表和存储桶 / Not found: check the table and the bucket in Supabase. (${err.message})`;
        case 409:
          return `Supabase 拒绝了这次修改，请重试 / Supabase rejected the change, please try again. (${err.message})`;
        case 413:
          return `文件太大，超过 Supabase 的上限 / The file is larger than Supabase allows. (${err.message})`;
        default:
          return `Supabase ${err.status}: ${err.message}`;
      }
    }
    if (err instanceof TypeError) {
      return "网络错误，请检查网络后重试 / Network error. Check the connection and try again.";
    }
    return err && err.message ? err.message : String(err);
  }

  // ---------- operations ----------
  // Each one uploads new files first, then switches the list row to them, then deletes the files
  // the row no longer points at, and reads the list again. They return { list, warning }: warning
  // is "" or a note about an old file left behind.

  // Upload the chosen picture under a new name. Returns that name, or "" when none was chosen.
  async function putThumb(key, file, stamp) {
    if (!file) return "";
    const ext = thumbExt(file);
    const name = versionedName(key, stamp, ext);
    setStatus("正在上传图片… / Uploading the picture…");
    await putFile(name, file, THUMB_TYPES[ext]);
    return name;
  }

  // Save the row. If that fails, the files just uploaded for it are removed again (best effort;
  // Delete would remove any that stay, since it deletes every "<key>_…" file).
  async function saveRow(key, newFiles, save) {
    try {
      return await save();
    } catch (err) {
      try {
        await removeFiles(key, newFiles.filter(Boolean));
      } catch {
        // Left for a later Delete.
      }
      throw err;
    }
  }

  // Delete the files the row no longer points at (the old game version, an old picture).
  // The save itself already worked, so a failure is only a warning.
  async function dropOldFiles(key, before, after) {
    const old = before ? [before.file, before.thumb] : [];
    const names = old.filter((name) => name && name !== after.file && name !== after.thumb);
    try {
      await removeFiles(key, names);
      return "";
    } catch (err) {
      return `旧文件没有删除 / An old file was not deleted: ${describeError(err)}`;
    }
  }

  // `fields` comes from pageFields(): key, title, description, textbook, volume, lesson, author.
  // `thumbFile` is the chosen picture, or undefined to keep the current one (if any).
  async function uploadPage(file, fields, thumbFile) {
    const { key } = fields;
    const before = await fetchRow(key);
    const stamp = versionStamp();
    const htmlName = versionedName(key, stamp, "html");
    setStatus(
      `正在上传 ${(file.size / MB).toFixed(1)} MB… / Uploading ${(file.size / MB).toFixed(1)} MB…`,
    );
    await putFile(htmlName, file, HTML_TYPE);
    const newThumb = await saveRow(key, [htmlName], () => putThumb(key, thumbFile, stamp));
    const after = { file: htmlName, thumb: newThumb || (before ? before.thumb : "") };
    setStatus("正在保存列表… / Saving the list…");
    await saveRow(key, [htmlName, newThumb], async () => {
      const rows = await call(`/rest/v1/${TABLE}?on_conflict=key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        json: { ...fields, ...after, updated: nowIso() },
      });
      if (!Array.isArray(rows) || rows.length === 0) throw new Error(ROW_NOT_SAVED);
    });
    const warning = await dropOldFiles(key, before, after);
    return { list: await fetchList(), warning };
  }

  // `thumbFile`: a new picture (or undefined). `removeThumb`: drop the picture.
  // The game file keeps its name, so devices don't download the game again.
  async function editPage(fields, thumbFile, removeThumb) {
    const { key } = fields;
    const before = await fetchRow(key);
    if (!before) throw new Error(PAGE_GONE);
    const newThumb = await putThumb(key, thumbFile, versionStamp());
    const after = { file: before.file, thumb: newThumb || (removeThumb ? "" : before.thumb) };
    setStatus("正在保存… / Saving…");
    await saveRow(key, [newThumb], async () => {
      const rows = await call(`/rest/v1/${TABLE}?${rowFilter(key)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        json: { ...fields, thumb: after.thumb, updated: nowIso() },
      });
      // When a policy blocks the update, nothing changes and the answer is still 200.
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error((await fetchRow(key)) ? ROW_NOT_SAVED : PAGE_GONE);
      }
    });
    const warning = await dropOldFiles(key, before, after);
    return { list: await fetchList(), warning };
  }

  // Files first, row last: if a step fails, the game is still listed and pressing Delete again
  // finishes the job, so no file is left without a list entry. Every file of the game is deleted
  // (all versions), so anything an earlier failed cleanup left behind goes too.
  async function deletePage(key) {
    setStatus("正在删除文件… / Deleting the files…");
    await removeFiles(key, await filesOf(key));
    setStatus("正在更新列表… / Updating the list…");
    const rows = await call(`/rest/v1/${TABLE}?${rowFilter(key)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    // An empty answer is fine only when the row is really gone (it may have been deleted already).
    if ((!Array.isArray(rows) || rows.length === 0) && (await fetchRow(key))) {
      throw new Error(ROW_NOT_SAVED);
    }
    return { list: await fetchList(), warning: "" };
  }

  // Show the new list everywhere, and the outcome (plus any warning) in the dialog.
  function afterSave(result, message) {
    list = result.list;
    renderList();
    notifyPages();
    if (result.warning) {
      setStatus(`${message} ${result.warning}`, "error");
    } else {
      setStatus(message, "ok");
    }
  }

  function needSignIn() {
    if (!CONFIGURED) {
      setStatus(NOT_CONFIGURED, "error");
      return false;
    }
    if (session) return true;
    setStatus("请先在 ① 登录 / Sign in in section ① first.", "error");
    signinEmail.focus();
    return false;
  }

  async function runTask(work) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setStatus(describeError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  // Read the newest list (signed in or not: anyone may read it).
  async function loadList() {
    setStatus("正在读取列表… / Loading the list…");
    list = await fetchList();
    renderList();
    notifyPages();
    setStatus("");
  }

  async function refreshList() {
    if (!CONFIGURED || busy) return;
    await runTask(loadList);
  }

  // ---------- thumbnails made from the game ----------
  // The game's HTML is only searched as text: none of its scripts run.

  // The biggest distinct pictures embedded in the HTML, as data: URLs.
  function findEmbeddedImages(html) {
    const seen = new Set();
    const found = [];
    for (const match of html.matchAll(DATA_IMAGE_RE)) {
      const data = match[2].replace(/\\/g, "");
      if (data.length < THUMB_SOURCE_MIN_B64) continue;
      const id = `${data.length}:${data.slice(-64)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(`data:image/${match[1]};base64,${data}`);
    }
    return found.sort((a, b) => b.length - a.length).slice(0, THUMB_SOURCES_MAX);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.addEventListener("load", () => resolve(img));
      img.addEventListener("error", () => reject(new Error("unreadable picture")));
      img.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  // Crop to 4:3 and scale to THUMB_WIDTH × THUMB_HEIGHT. A tall picture keeps its top (where the
  // title usually is), a wide one its middle. WebP, or JPEG where the browser can't write WebP.
  async function makeThumb(img) {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const ratio = THUMB_WIDTH / THUMB_HEIGHT;
    let sx = 0;
    let sw = width;
    let sh = height;
    if (width / height > ratio) {
      sw = Math.round(height * ratio);
      sx = Math.round((width - sw) / 2);
    } else {
      sh = Math.round(width / ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, 0, sw, sh, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    let blob = await canvasBlob(canvas, "image/webp", 0.82);
    if (!blob || blob.type !== "image/webp") {
      // JPEG has no transparency: put the page's surface color behind the picture.
      const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
      if (surface) {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = surface;
        ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      }
      blob = await canvasBlob(canvas, "image/jpeg", 0.85);
    }
    if (!blob) throw new Error("无法生成缩略图 / Could not make the thumbnail.");
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `thumbnail.${ext}`, { type: blob.type });
  }

  // Thumbnail files made from the game's pictures, biggest picture first.
  async function thumbsFromHtml(html) {
    const files = [];
    for (const url of findEmbeddedImages(html)) {
      try {
        const img = await loadImage(url);
        if (Math.min(img.naturalWidth, img.naturalHeight) < THUMB_SOURCE_MIN_PX) continue;
        files.push(await makeThumb(img));
      } catch {
        // Not a picture the browser can read: skip it.
      }
      if (files.length >= THUMB_CHOICES_MAX) break;
    }
    return files;
  }

  // The thumbnail choices under a form. `selected` is an index into `files`, or -1 for the
  // last button ("No picture" / "Keep current").
  function makePicker(prefix) {
    return {
      box: byId(`${prefix}-thumb-pick`),
      note: byId(`${prefix}-thumb-pick-note`),
      choices: byId(`${prefix}-thumb-choices`),
      files: [],
      urls: [],
      selected: -1,
      run: 0,
    };
  }

  const uploadPicker = makePicker("upload");
  const editPicker = makePicker("edit");

  function clearPicker(picker) {
    picker.run += 1; // a scan still running for this form is dropped
    picker.urls.forEach((url) => URL.revokeObjectURL(url));
    picker.files = [];
    picker.urls = [];
    picker.selected = -1;
    picker.choices.replaceChildren();
    picker.note.textContent = "";
    picker.box.hidden = true;
  }

  function choiceButton(index, pressed) {
    const btn = el("button", "thumb-choice");
    btn.type = "button";
    btn.dataset.index = String(index);
    btn.setAttribute("aria-pressed", String(pressed));
    btn.disabled = busy;
    return btn;
  }

  function renderPicker(picker, noneLabel) {
    const buttons = picker.urls.map((url, index) => {
      const btn = choiceButton(index, picker.selected === index);
      btn.setAttribute("aria-label", `缩略图 ${index + 1} / Thumbnail ${index + 1}`);
      const img = el("img");
      img.src = url;
      img.alt = "";
      btn.append(img);
      return btn;
    });
    const none = choiceButton(-1, picker.selected === -1);
    none.classList.add("thumb-choice-none");
    none.textContent = noneLabel;
    picker.choices.replaceChildren(...buttons, none);
  }

  // The chosen thumbnail as a File, or undefined.
  function pickerFile(picker) {
    return picker.files[picker.selected];
  }

  // Find pictures in a game and offer them as thumbnails. `readHtml` returns the game's HTML.
  // `hasThumb`: the game already has a picture, so the last choice reads "Keep current".
  async function scanGame(picker, readHtml, { hasThumb, preferNone }) {
    clearPicker(picker);
    const run = picker.run;
    picker.box.hidden = false;
    picker.note.textContent = "正在从游戏中找图片… / Looking for pictures in the game…";
    try {
      const html = await readHtml();
      if (run !== picker.run) return;
      const files = await thumbsFromHtml(html);
      if (run !== picker.run) return;
      if (files.length === 0) {
        picker.note.textContent =
          "游戏里没有找到合适的图片，可以自己选一张图片 / No suitable picture in the game. You can choose a picture file instead.";
        return;
      }
      picker.files = files;
      picker.urls = files.map((file) => URL.createObjectURL(file));
      picker.selected = preferNone ? -1 : 0;
      picker.note.textContent =
        "用游戏里的图片做的缩略图，点一下选择；上面选了图片文件时以文件为准 / Thumbnails made from the game's pictures: click one to choose it. A picture file chosen above is used instead.";
      renderPicker(
        picker,
        hasThumb ? "保留原图片 / Keep current" : "不用图片 / No picture",
      );
    } catch (err) {
      if (run !== picker.run) return;
      picker.note.textContent = describeError(err);
    }
  }

  // The uploaded game as it is in the bucket.
  async function fetchLiveGame(key) {
    const page = list.find((entry) => entry.key === key);
    if (!page) throw new Error(PAGE_GONE);
    const res = await nativeFetch(`${FILE_BASE}${page.file}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        `无法读取存储里的游戏（HTTP ${res.status}）/ Couldn't load the game from storage (HTTP ${res.status}).`,
      );
    }
    return res.text();
  }

  // ---------- validation ----------

  function fail(field, message) {
    setStatus(message, "error");
    field.focus();
    return false;
  }

  // `fields` is uploadFields or editFields.
  function checkPageFields(fields) {
    const title = fields.title.value.trim();
    if (!title) return fail(fields.title, "请填写标题 / Enter a title.");
    if (title.length > TITLE_MAX) {
      return fail(fields.title, `标题最多 ${TITLE_MAX} 个字 / Title: up to ${TITLE_MAX} characters.`);
    }
    if (fields.description.value.trim().length > DESC_MAX) {
      return fail(fields.description, `说明最多 ${DESC_MAX} 个字 / Description: up to ${DESC_MAX} characters.`);
    }
    if (fields.textbook.value.trim().length > TEXTBOOK_MAX) {
      return fail(fields.textbook, `教材最多 ${TEXTBOOK_MAX} 个字 / Textbook: up to ${TEXTBOOK_MAX} characters.`);
    }
    if (fields.volume.value.trim().length > VOLUME_MAX) {
      return fail(fields.volume, `册最多 ${VOLUME_MAX} 个字 / Volume: up to ${VOLUME_MAX} characters.`);
    }
    // A number field reports "" for text it can't read (like "abc"); badInput catches that.
    const lesson = fields.lesson.value.trim();
    if (
      fields.lesson.validity.badInput ||
      (lesson && (!/^\d+$/.test(lesson) || cleanLesson(Number(lesson)) === null))
    ) {
      return fail(
        fields.lesson,
        `课只能填 1–${LESSON_MAX} 的整数，或留空 / Lesson: a whole number from 1 to ${LESSON_MAX}, or empty.`,
      );
    }
    if (fields.author.value.trim().length > AUTHOR_MAX) {
      return fail(fields.author, `作者最多 ${AUTHOR_MAX} 个字 / Author: up to ${AUTHOR_MAX} characters.`);
    }
    return true;
  }

  // The picture is optional: nothing chosen is fine.
  function checkThumb(field) {
    const file = field.files[0];
    if (!file) return true;
    if (!thumbExt(file)) {
      return fail(field, "图片只能是 PNG、JPG 或 WebP / The picture must be a PNG, JPG or WebP file.");
    }
    if (file.size === 0) return fail(field, "图片是空的 / The picture is empty.");
    if (file.size > THUMB_MAX_MB * MB) {
      return fail(
        field,
        `图片太大（最大 ${THUMB_MAX_MB} MB）/ The picture is larger than ${THUMB_MAX_MB} MB.`,
      );
    }
    return true;
  }

  // The entry's fields as typed in a form. An empty lesson is saved as null.
  function pageFields(key, fields) {
    const lesson = fields.lesson.value.trim();
    return {
      key,
      title: fields.title.value.trim(),
      description: fields.description.value.trim(),
      textbook: fields.textbook.value.trim(),
      volume: fields.volume.value.trim(),
      lesson: lesson ? Number(lesson) : null,
      author: fields.author.value.trim(),
    };
  }

  // Put an entry's fields into a form.
  function fillFields(fields, page) {
    Object.keys(fields).forEach((name) => {
      const value = page[name];
      fields[name].value = value === null || value === undefined ? "" : String(value);
    });
  }

  function checkUploadForm() {
    const file = uploadFile.files[0];
    if (!file) return fail(uploadFile, "请选择文件 / Choose a file.");
    if (!/\.html?$/i.test(file.name)) {
      return fail(uploadFile, "只能上传 .html 文件 / Only .html or .htm files can be uploaded.");
    }
    if (file.size === 0) return fail(uploadFile, "文件是空的 / The file is empty.");
    if (file.size > MAX_UPLOAD_MB * MB) {
      return fail(
        uploadFile,
        `文件太大（最大 ${MAX_UPLOAD_MB} MB）/ The file is larger than ${MAX_UPLOAD_MB} MB.`,
      );
    }
    const key = uploadKey.value.trim();
    if (!KEY_PATTERN.test(key)) {
      return fail(
        uploadKey,
        "键只能用小写字母、数字和 -，以字母或数字开头，最多 40 个 / Key: a–z, 0–9 and -, starting with a letter or digit, up to 40.",
      );
    }
    if (RESERVED_KEYS.has(key)) {
      return fail(uploadKey, `“${key}” 已被内置页面使用 / "${key}" is used by a built-in page.`);
    }
    return checkPageFields(uploadFields) && checkThumb(uploadThumb);
  }

  // ---------- rendering ----------

  // Signed out: the email/password row. Signed in: who, and the Sign out button.
  function renderSignInState() {
    signinForm.hidden = Boolean(session) || !CONFIGURED;
    signinOutRow.hidden = !session;
    signinRemember.checked = rememberSession;
    if (!CONFIGURED) {
      signinState.textContent = NOT_CONFIGURED;
    } else if (!session) {
      signinState.textContent = "未登录：只能查看 / Not signed in: view only.";
    } else if (rememberSession) {
      signinState.textContent = `已登录：${session.email}，保存在此设备 / Signed in as ${session.email}, remembered on this device.`;
    } else {
      signinState.textContent = `已登录：${session.email}，仅本次打开有效 / Signed in as ${session.email} for this visit only.`;
    }
  }

  function actionButton(action, label, page) {
    const btn = el("button", `btn btn-small${action === "delete" ? " btn-danger" : ""}`, label);
    btn.type = "button";
    btn.dataset.action = action;
    btn.dataset.key = page.key;
    btn.setAttribute("aria-label", `${label} ${page.title}`);
    btn.disabled = busy;
    return btn;
  }

  function renderList() {
    const rows = list.map((page) => {
      const row = el("li", "page-row");
      const info = el("div", "page-row-info");
      const title = el("strong", "page-row-title", page.title);
      title.lang = "zh-Hans";
      const desc = el("span", "page-row-desc", page.description || "—");
      desc.lang = "zh-Hans";
      desc.title = page.description;
      info.append(title, el("code", "page-row-key", page.key));
      // "教材：人教语文 · 二年级上册 · 第三课", leaving out the parts that are empty.
      const bookParts = [page.textbook, page.volume, lessonLabel(page.lesson)].filter(Boolean);
      if (bookParts.length > 0) {
        const book = el("span", "page-row-book", `教材：${bookParts.join(" · ")}`);
        book.lang = "zh-Hans";
        info.append(book);
      }
      if (page.author) {
        const author = el("span", "page-row-author", `作者：${page.author}`);
        author.lang = "zh-Hans";
        info.append(author);
      }
      if (page.thumb) info.append(el("span", "page-row-thumb", "有图片 / Has picture"));
      info.append(el("span", "page-row-date", page.updated.slice(0, 10)), desc);
      const actions = el("div", "page-row-actions");
      actions.append(
        actionButton("edit", "编辑 Edit", page),
        actionButton("replace", "替换 Replace", page),
        actionButton("delete", "删除 Delete", page),
      );
      row.append(info, actions);
      return row;
    });
    pageList.replaceChildren(...rows);

    if (!CONFIGURED) {
      listNote.textContent = NOT_CONFIGURED;
    } else if (list.length === 0) {
      listNote.textContent = "还没有上传的页面 / No uploaded pages yet.";
    } else {
      listNote.textContent = "";
    }
    listNote.hidden = !listNote.textContent;
  }

  function startEdit(page) {
    editingKey = page.key;
    editHeading.textContent = `编辑 / Edit: ${page.title} (${page.key})`;
    fillFields(editFields, page);
    editThumb.value = "";
    editThumbRemove.checked = false;
    editThumbRemoveRow.hidden = !page.thumb;
    clearPicker(editPicker);
    editForm.hidden = false;
    editTitle.focus();
  }

  function stopEdit() {
    editingKey = null;
    clearPicker(editPicker);
    editForm.hidden = true;
  }

  // ---------- events ----------

  // Opening the dialog always reads the newest list.
  manageBtn.addEventListener("click", () => {
    renderSignInState();
    renderList();
    updateUploadButton();
    if (!dialog.open) dialog.showModal();
    refreshList();
  });

  closeBtn.addEventListener("click", () => dialog.close());

  signinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !CONFIGURED) return;
    const email = signinEmail.value.trim();
    const password = signinPassword.value;
    if (!email) return fail(signinEmail, "请填写邮箱 / Enter your email.");
    if (!password) return fail(signinPassword, "请填写密码 / Enter your password.");
    runTask(async () => {
      setStatus("正在登录… / Signing in…");
      try {
        rememberSession = signinRemember.checked;
        keepSession(await authRequest("password", { email, password }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          throw new Error("邮箱或密码不对 / Wrong email or password.");
        }
        throw err;
      }
      signinPassword.value = "";
      renderSignInState();
      await loadList();
      setStatus(`✓ 已登录 / Signed in as ${session.email}.`, "ok");
    });
  });

  // Signing out ends the session in Supabase too (best effort) and forgets it here.
  signinOut.addEventListener("click", () => {
    if (busy || !session) return;
    const bearer = session.access_token;
    nativeFetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}` },
    }).catch(() => {
      // Offline: the session still ends here, and its tokens expire on their own.
    });
    dropSession();
    setStatus("已退出 / Signed out.");
  });

  signinRemember.addEventListener("change", () => {
    rememberSession = signinRemember.checked;
    saveSession(rememberSession ? session : null);
    renderSignInState();
  });

  uploadFile.addEventListener("change", () => {
    const file = uploadFile.files[0];
    if (!file) {
      uploadNote.hidden = true;
      clearPicker(uploadPicker);
      return;
    }
    const sizeMb = file.size / MB;
    let note = `${file.name} · ${sizeMb.toFixed(1)} MB`;
    if (sizeMb > LARGE_UPLOAD_MB) {
      note += " · 文件较大，上传可能需要一两分钟 / Large file: the upload may take a minute or two.";
    }
    uploadNote.textContent = note;
    uploadNote.hidden = false;

    // Suggest a key from the file name unless the teacher has typed their own.
    const key = uploadKey.value.trim();
    if (!key || key === uploadKey.defaultValue) {
      const base = file.name.replace(/\.html?$/i, "");
      if (KEY_PATTERN.test(base) && !RESERVED_KEYS.has(base)) uploadKey.value = base;
    }
    updateUploadButton();

    // Offer thumbnails made from the game. When replacing a game that already has a picture,
    // keeping that picture stays the default.
    if (/\.html?$/i.test(file.name)) {
      const existing = list.find((page) => page.key === uploadKey.value.trim());
      const hasThumb = Boolean(existing && existing.thumb);
      scanGame(uploadPicker, () => file.text(), { hasThumb, preferNone: hasThumb });
    } else {
      clearPicker(uploadPicker);
    }
  });

  // Choosing one of the thumbnails made from the game.
  [uploadPicker, editPicker].forEach((picker) => {
    picker.choices.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-index]");
      if (!btn || busy) return;
      picker.selected = Number(btn.dataset.index);
      picker.choices.querySelectorAll("button[data-index]").forEach((choice) => {
        choice.setAttribute("aria-pressed", String(choice === btn));
      });
    });
  });

  // Edit → "From the game": load the game from the live site and offer its pictures.
  editFromGame.addEventListener("click", () => {
    const key = editingKey;
    if (!key || busy) return;
    const page = list.find((entry) => entry.key === key);
    editThumbRemove.checked = false;
    scanGame(editPicker, () => fetchLiveGame(key), {
      hasThumb: Boolean(page && page.thumb),
      preferNone: false,
    });
  });

  // Typing in the key or title, or picking a file.
  uploadForm.addEventListener("input", updateUploadButton);

  // Clear (and uploadForm.reset()) empties every field, instead of going back to the
  // example values written in index.html.
  uploadForm.addEventListener("reset", (event) => {
    event.preventDefault();
    uploadFile.value = "";
    uploadThumb.value = "";
    uploadKey.value = "";
    Object.values(uploadFields).forEach((field) => {
      field.value = "";
    });
    uploadNote.hidden = true;
    clearPicker(uploadPicker);
    updateUploadButton();
  });

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !needSignIn() || !checkUploadForm()) return;
    const file = uploadFile.files[0];
    // A picture file chosen by hand wins over a thumbnail made from the game.
    const thumbFile = uploadThumb.files[0] || pickerFile(uploadPicker);
    const fields = pageFields(uploadKey.value.trim(), uploadFields);
    const { key } = fields;
    if (
      list.some((page) => page.key === key) &&
      !window.confirm(`“${key}” 已存在，要替换它吗？\nA page with the key "${key}" already exists. Replace it?`)
    ) {
      return;
    }
    runTask(async () => {
      const result = await uploadPage(file, fields, thumbFile);
      uploadForm.reset();
      if (editingKey === key) stopEdit();
      afterSave(result, `✓ 已上传 “${fields.title}”，已上线 / Uploaded. It is live now.`);
    });
  });

  pageList.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn || busy) return;
    const page = list.find((entry) => entry.key === btn.dataset.key);
    if (!page) return;

    if (btn.dataset.action === "edit") {
      startEdit(page);
    } else if (btn.dataset.action === "replace") {
      uploadForm.reset();
      uploadKey.value = page.key;
      fillFields(uploadFields, page);
      updateUploadButton();
      setStatus(`请选择新文件来替换 “${page.title}” / Choose the new file to replace "${page.title}".`);
      uploadForm.scrollIntoView({ block: "nearest" });
      uploadFile.focus();
    } else if (btn.dataset.action === "delete") {
      if (!needSignIn()) return;
      if (!window.confirm(`删除 “${page.title}”（${page.key}）？\nDelete "${page.title}" (${page.key})?`)) {
        return;
      }
      runTask(async () => {
        const result = await deletePage(page.key);
        if (editingKey === page.key) stopEdit();
        afterSave(result, "✓ 已删除（游戏文件和图片都已删除）/ Deleted, with its file and picture.");
      });
    }
  });

  editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = editingKey;
    if (busy || !key || !needSignIn() || !checkPageFields(editFields) || !checkThumb(editThumb)) return;
    const fields = pageFields(key, editFields);
    // A picture file chosen by hand wins, then "Remove the picture", then a thumbnail from the game.
    const removeThumb = editThumbRemove.checked;
    const thumbFile = editThumb.files[0] || (removeThumb ? undefined : pickerFile(editPicker));
    runTask(async () => {
      const result = await editPage(fields, thumbFile, removeThumb);
      stopEdit();
      afterSave(result, "✓ 已保存，已上线 / Saved. It is live now.");
    });
  });

  editCancel.addEventListener("click", stopEdit);

  updateUploadButton();
})();
