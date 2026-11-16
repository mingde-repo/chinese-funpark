"use strict";

// Main page: shows one game at a time in the iframe, driven by the URL hash.
// The nav holds the built-in games and a "…" button that opens #contents: a grid of thumbnail
// cards for the uploaded games, under a filter bar (field → value, or a keyword) whose filters add up.
// Uploaded games live in Supabase: the list in the table `pages`, the files in the Storage bucket
// `games`. The list is read once at start-up and again from "pages-changed" events sent by
// js/manage.js.
(() => {
  // Keep our own reference, taken before any game page loads (games run on this origin).
  const nativeFetch = window.fetch.bind(window);

  // The Supabase project is set once, in the <meta> tags at the top of index.html.
  function metaContent(name) {
    const node = document.querySelector(`meta[name="${name}"]`);
    return node ? node.content.trim() : "";
  }
  const SUPABASE_URL = metaContent("mingde-supabase-url").replace(/\/+$/, "");
  const SUPABASE_KEY = metaContent("mingde-supabase-anon-key");
  const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);
  const LIST_URL = `${SUPABASE_URL}/rest/v1/pages?select=*&order=key`;
  const FILE_BASE = `${SUPABASE_URL}/storage/v1/object/public/games/`;
  // Storage serves .html as text/plain, so a game is shown from a blob: URL of this type.
  const GAME_TYPE = "text/html;charset=utf-8";

  const BUILTIN_PAGES = {
    adventure: {
      src: "pages/adventure-world.html",
      title: "中文冒险世界",
      description: "六大魔法关卡，闯关学中文",
    },
    bubbles: {
      src: "pages/pinyin-bubbles.html",
      title: "拼音泡泡大作战",
      description: "打泡泡，练拼音；老师可管理词表",
    },
  };
  const DEFAULT_PAGE = "adventure";
  const CONTENTS_KEY = "contents";
  const CONTENTS_META = { title: "目录", description: "" };
  const SITE_TITLE = "明德中文乐园";
  const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const TITLE_MAX = 40;
  const DESC_MAX = 200;
  const AUTHOR_MAX = 40;
  const TEXTBOOK_MAX = 40;
  const VOLUME_MAX = 20;
  const LESSON_MAX = 999;
  const CN_DIGITS = "零一二三四五六七八九";
  // Every version of a game file has its own name in the bucket, <key>_v<14 digits>.<ext>, and
  // the list row holds the current names (`file`, and `thumb` for the picture). So a link never
  // points at an old version, and no cache can serve one. Without a picture, a card shows a
  // colored tile (one of TILE_COUNT colors in css/style.css, picked from the key).
  const VERSIONED_NAME = /^([a-z0-9][a-z0-9-]{0,39})_v(\d{14})\.(html|png|jpg|webp)$/;
  const THUMB_EXTS = ["png", "jpg", "webp"];
  const TILE_COUNT = 6;
  const LOADING_STATUS = "加载中… / Loading…";
  // What the contents page says while it has no games, by the state of the list.
  const EMPTY_TEXT = {
    loading: "正在读取游戏列表… / Loading the game list…",
    error: "无法读取游戏列表，请检查网络后刷新 / Couldn't load the game list. Check the connection and reload.",
    unconfigured: "网站还没有连接 Supabase（见 README）/ The site isn't connected to Supabase yet (see README).",
    ok: "还没有上传的游戏 / No uploaded games yet.",
  };
  // Filter bar: pick a field, then one of its values ("all", or "=<value>" for matching rows
  // only). Each field keeps its own value, and a row must match them all. The extra field
  // KEYWORD_FIELD ("关键词 / Text") shows a text box instead: text that the title, description,
  // textbook, volume, lesson or author must contain (case-insensitive).
  const FILTER_COLUMNS = ["title", "textbook", "volume", "lesson", "author"];
  const KEYWORD_FIELD = "text";
  const FIELD_NAMES = { title: "标题", textbook: "教材", volume: "册", lesson: "课", author: "作者", text: "关键词" };
  const FILTER_ALL = "all";
  const OPTION_TEXT_MAX = 30;

  const nav = document.querySelector(".shell-nav");
  const statusEl = document.getElementById("status");
  const descEl = document.getElementById("page-desc");
  const navCurrent = document.getElementById("nav-current");
  const contentsView = document.getElementById("contents-view");
  const contentsGrid = document.getElementById("contents-grid");
  const contentsCount = document.getElementById("contents-count");
  const contentsEmpty = document.getElementById("contents-empty");
  const filtersClear = document.getElementById("filters-clear");
  const filterField = document.getElementById("filter-field");
  const filterValue = document.getElementById("filter-value");
  const filterText = document.getElementById("filter-text");
  const valueGroup = filterValue.closest(".filter-group");
  const textGroup = filterText.closest(".filter-group");
  const filterActive = document.getElementById("filter-active");
  // Per field: the chosen drop-down value. Plus one keyword (as typed, not normalized).
  const criteria = {};
  let keyword = "";
  let frame = document.getElementById("content");

  let pages = { ...BUILTIN_PAGES };
  let uploaded = [];
  let listState = CONFIGURED ? "loading" : "unconfigured";
  let currentKey = null;
  let gotManagerList = false;
  // Each showPage() counts up, so a game that finishes loading after the user moved on is dropped.
  let loadRun = 0;
  // The blob: URL of the uploaded game on show ("" for none), revoked when the page changes.
  let gameUrl = "";

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
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

  // `name` if it is a file name of this game with one of `exts`, else "".
  function cleanFileName(name, key, exts) {
    const match = typeof name === "string" ? VERSIONED_NAME.exec(name) : null;
    return match && match[1] === key && exts.includes(match[3]) ? name : "";
  }

  // Keep only well-formed entries; the list is written by the site but is still input.
  function cleanList(raw) {
    const result = [];
    if (!Array.isArray(raw)) return result;
    const seen = new Set();
    raw.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const { key, title } = entry;
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) return;
      if (hasOwn(BUILTIN_PAGES, key) || key === CONTENTS_KEY || seen.has(key)) return;
      if (typeof title !== "string" || !title.trim() || title.length > TITLE_MAX) return;
      // A row without a game file can't be opened, so it isn't listed.
      const file = cleanFileName(entry.file, key, ["html"]);
      if (!file) return;
      seen.add(key);
      result.push({
        key,
        file,
        title: title.trim(),
        description: cleanText(entry.description, DESC_MAX),
        // Older entries have a single "book" text instead; show it as the textbook.
        textbook: cleanText(hasOwn(entry, "textbook") ? entry.textbook : entry.book, TEXTBOOK_MAX),
        volume: cleanText(entry.volume, VOLUME_MAX),
        lesson: cleanLesson(entry.lesson),
        author: cleanText(entry.author, AUTHOR_MAX),
        thumb: cleanFileName(entry.thumb, key, THUMB_EXTS),
        updated: typeof entry.updated === "string" ? entry.updated : "",
      });
    });
    return result;
  }

  function pageFromHash() {
    const key = window.location.hash.slice(1);
    return key === CONTENTS_KEY || hasOwn(pages, key) ? key : null;
  }

  // Built-in games light up their own button; the contents page and uploaded games light up "…".
  // An uploaded game also shows its title right after "…".
  function markActive() {
    const active = hasOwn(BUILTIN_PAGES, currentKey) ? currentKey : CONTENTS_KEY;
    nav.querySelectorAll(".nav-btn[data-page]").forEach((btn) => {
      if (btn.dataset.page === active) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
    const isUploaded =
      currentKey !== CONTENTS_KEY && !hasOwn(BUILTIN_PAGES, currentKey) && hasOwn(pages, currentKey);
    navCurrent.textContent = isUploaded ? pages[currentKey].title : "";
    navCurrent.title = navCurrent.textContent;
    navCurrent.hidden = !isUploaded;
  }

  // Description line ("description · 作者：author") and tab title for the open page.
  function showMeta(key) {
    const page = key === CONTENTS_KEY ? CONTENTS_META : pages[key];
    const parts = [page.description, page.author ? `作者：${page.author}` : ""].filter(Boolean);
    descEl.textContent = parts.join(" · ");
    descEl.hidden = parts.length === 0;
    frame.title = page.title;
    document.title = `${page.title} · ${SITE_TITLE}`;
  }

  function revokeGameUrl() {
    if (gameUrl) URL.revokeObjectURL(gameUrl);
    gameUrl = "";
  }

  // An uploaded game: Storage serves it as text/plain, so load it and show it from a blob: URL.
  // Over http(s) a blob: page has this page's origin, so the game's localStorage and the
  // postMessage check work as they did when the games were files on this site.
  // If the file is gone (a teacher replaced the game after this page read the list), the list
  // is read again once and the new version opened.
  async function loadGame(key, run, retried = false) {
    statusEl.textContent = LOADING_STATUS;
    const src = pages[key].src;
    try {
      const res = await nativeFetch(src);
      if (!res.ok && !retried) {
        applyList(cleanList(await fetchListRows()));
        if (run !== loadRun) return; // the game was deleted, and the default page is shown
        if (hasOwn(pages, key) && pages[key].src !== src) {
          loadGame(key, run, true);
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.blob();
      if (run !== loadRun) return;
      gameUrl = URL.createObjectURL(new Blob([data], { type: GAME_TYPE }));
      // Swap in another fresh iframe that starts on the game, instead of setting src on the
      // empty one: a later src change could add a history entry, and under file:// Chrome and
      // Edge load a blob: URL only as an iframe's first page.
      const ready = frame.cloneNode(false);
      ready.src = gameUrl;
      frame.replaceWith(ready);
      frame = ready;
      statusEl.textContent = "";
    } catch (err) {
      if (run !== loadRun) return;
      statusEl.textContent = `无法加载游戏 / Couldn't load the game (${err.message})`;
    }
  }

  function showPage(key) {
    const isContents = key === CONTENTS_KEY;
    const page = isContents ? null : pages[key];

    // Swap in a fresh iframe instead of changing src, so sub-page loads don't add
    // their own history entries. The URL hash stays the only navigation history.
    // On the contents page the iframe is emptied, so a game's sound stops.
    const fresh = frame.cloneNode(false);
    fresh.removeAttribute("src");
    if (page && !page.remote) fresh.src = page.src;
    fresh.hidden = isContents;
    frame.replaceWith(fresh);
    frame = fresh;
    contentsView.hidden = !isContents;

    // The old game is gone with its iframe, so its blob: URL can go too.
    loadRun += 1;
    revokeGameUrl();
    statusEl.textContent = "";
    if (page && page.remote) loadGame(key, loadRun);

    currentKey = key;
    markActive();
    showMeta(key);
  }

  function route() {
    const key = pageFromHash();
    if (key) {
      showPage(key);
      return;
    }
    // Missing or unknown hash: fall back to the default without adding history.
    window.history.replaceState(null, "", `#${DEFAULT_PAGE}`);
    showPage(DEFAULT_PAGE);
  }

  // ---------- contents page (filters + cards) ----------

  function normalize(text) {
    return text.trim().toLocaleLowerCase();
  }

  function shorten(text) {
    return text.length > OPTION_TEXT_MAX ? `${text.slice(0, OPTION_TEXT_MAX)}…` : text;
  }

  // The value a drop-down matches on: the text, or the lesson number as text ("" when empty).
  function columnValue(row, column) {
    if (column === "lesson") return row.lesson === null ? "" : String(row.lesson);
    return row[column];
  }

  // What the drop-down shows.
  function columnLabel(value, column) {
    return column === "lesson" && value ? lessonLabel(Number(value)) : value;
  }

  // What the keyword searches: all of a game's text. The lesson matches both "3" and "第三课".
  function searchText(row) {
    const lesson = row.lesson === null ? "" : `${row.lesson} ${lessonLabel(row.lesson)}`;
    return [row.title, row.description, row.textbook, row.volume, lesson, row.author].join("\n");
  }

  // Empty first, then lessons by number and text in Chinese order.
  function compareValues(a, b, column) {
    if (column === "lesson") return (a ? Number(a) : 0) - (b ? Number(b) : 0);
    return a.localeCompare(b, "zh-Hans");
  }

  function resetCriteria() {
    FILTER_COLUMNS.forEach((column) => {
      criteria[column] = FILTER_ALL;
    });
    keyword = "";
  }

  function anySet() {
    return FILTER_COLUMNS.some((column) => criteria[column] !== FILTER_ALL) || normalize(keyword) !== "";
  }

  // The chosen field: one of FILTER_COLUMNS, or KEYWORD_FIELD.
  function currentField() {
    const field = filterField.value;
    return field === KEYWORD_FIELD || FILTER_COLUMNS.includes(field) ? field : "title";
  }

  function passesValue(row, column) {
    const value = criteria[column];
    return value === FILTER_ALL || value === `=${columnValue(row, column)}`;
  }

  function passesKeyword(row) {
    const typed = normalize(keyword);
    return !typed || normalize(searchText(row)).includes(typed);
  }

  // A row passes when it matches the keyword and the value of every field (except skipColumn).
  function passes(row, skipColumn) {
    return (
      passesKeyword(row) &&
      FILTER_COLUMNS.every((column) => column === skipColumn || passesValue(row, column))
    );
  }

  // Refill the value drop-down for the current field: the values of the games that pass the
  // other fields' values and the keyword. The chosen value always stays in the list,
  // so a filter is never dropped without the teacher seeing it.
  function renderValueOptions() {
    const column = currentField();
    if (column === KEYWORD_FIELD) return;
    const chosen = criteria[column];
    const rows = uploaded.filter((row) => passes(row, column));
    const values = new Set(rows.map((row) => columnValue(row, column)));
    if (chosen !== FILTER_ALL) values.add(chosen.slice(1));
    const options = [new Option("全部 / All", FILTER_ALL)];
    [...values]
      .sort((a, b) => compareValues(a, b, column))
      .forEach((value) => {
        const label = columnLabel(value, column);
        const option = new Option(label ? shorten(label) : "（空）/ (empty)", `=${value}`);
        if (label) option.title = label;
        options.push(option);
      });
    filterValue.replaceChildren(...options);
    filterValue.value = chosen;
  }

  // Show the chosen field's control: its value drop-down (with the saved value), or the keyword box.
  function syncControls() {
    const field = currentField();
    const isKeyword = field === KEYWORD_FIELD;
    filterField.value = field;
    valueGroup.hidden = isKeyword;
    textGroup.hidden = !isKeyword;
    filterText.value = keyword;
    renderValueOptions();
  }

  function activeButton(field, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.dataset.field = field;
    button.title = "移除这个筛选 / Remove this filter";
    const label = document.createElement("span");
    label.lang = "zh-Hans";
    label.textContent = text;
    const mark = document.createElement("span");
    mark.className = "filter-chip-x";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✕";
    button.append(label, mark);
    return button;
  }

  // One button per filter that is set, e.g. "作者 = 王老师 ✕" or "关键词 包含 “3” ✕".
  function renderActive() {
    const buttons = [];
    FILTER_COLUMNS.forEach((column) => {
      const value = criteria[column];
      if (value === FILTER_ALL) return;
      const label = columnLabel(value.slice(1), column) || "（空）";
      buttons.push(activeButton(column, `${FIELD_NAMES[column]} = ${label}`));
    });
    if (normalize(keyword)) {
      buttons.push(activeButton(KEYWORD_FIELD, `${FIELD_NAMES[KEYWORD_FIELD]} 包含 “${keyword.trim()}”`));
    }
    filterActive.replaceChildren(...buttons);
    filterActive.hidden = buttons.length === 0;
  }

  // The same key always gets the same tile color.
  function tileIndex(key) {
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
    return hash % TILE_COUNT;
  }

  // Turn the thumbnail box into a colored tile with the title's first character.
  function showTile(box, row) {
    box.replaceChildren();
    box.classList.add("card-tile");
    box.dataset.tile = String(tileIndex(row.key));
    box.textContent = [...row.title][0] || "";
  }

  // The picture, or the tile when there is none (or it can't be loaded).
  function thumbBox(row) {
    const box = document.createElement("span");
    box.className = "card-thumb";
    box.setAttribute("aria-hidden", "true");
    if (!row.thumb) {
      showTile(box, row);
      return box;
    }
    const img = document.createElement("img");
    // `updated` changes with every save, so a replaced picture isn't served from the cache.
    img.src = `${FILE_BASE}${row.thumb}`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => showTile(box, row), { once: true });
    box.append(img);
    return box;
  }

  // Hovering a card shows the description, textbook · volume · lesson, author and file name.
  function cardTooltip(row) {
    const fileName = row.file;
    const book = [row.textbook, row.volume, lessonLabel(row.lesson)].filter(Boolean).join(" · ");
    return [
      row.description,
      book,
      row.author ? `作者：${row.author}` : "",
      `打开 / Open: ${fileName}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // A card: thumbnail + title, linking to its game.
  function card(row) {
    const li = document.createElement("li");
    const box = document.createElement("a");
    box.className = "card";
    box.href = `#${row.key}`;
    box.title = cardTooltip(row);
    const title = document.createElement("span");
    title.className = "card-title";
    title.lang = "zh-Hans";
    title.textContent = row.title;
    box.append(thumbBox(row), title);
    li.append(box);
    return li;
  }

  // Only uploaded games; the built-in ones have their own nav buttons.
  function renderRows() {
    const rows = uploaded;
    const shown = rows.filter((row) => passes(row, null));
    contentsGrid.replaceChildren(...shown.map(card));
    contentsCount.textContent = `显示 ${shown.length} / ${rows.length} 个 · Showing ${shown.length} of ${rows.length}`;
    contentsEmpty.textContent =
      rows.length === 0 ? EMPTY_TEXT[listState] : "没有符合筛选条件的游戏 / No games match the filters.";
    contentsEmpty.hidden = shown.length > 0;
    filtersClear.disabled = !anySet();
    renderActive();
  }

  function renderContents() {
    renderValueOptions();
    renderRows();
  }

  // ---------- uploaded list ----------

  function setUploaded(list) {
    uploaded = list;
    pages = { ...BUILTIN_PAGES };
    list.forEach((entry) => {
      pages[entry.key] = {
        src: `${FILE_BASE}${entry.file}`,
        remote: true,
        title: entry.title,
        description: entry.description,
        author: entry.author,
      };
    });
    renderContents();
  }

  function applyList(list) {
    listState = "ok";
    setUploaded(list);

    if (currentKey && currentKey !== CONTENTS_KEY && !hasOwn(pages, currentKey)) {
      // The open page was deleted.
      route();
      return;
    }
    if (currentKey) {
      markActive();
      showMeta(currentKey);
    }
  }

  // The rows of the Supabase table (public read, anon key only), never from a cache.
  async function fetchListRows() {
    const res = await nativeFetch(LIST_URL, { headers: { apikey: SUPABASE_KEY }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Read the list of uploaded games at start-up.
  async function loadList() {
    if (!CONFIGURED) return;
    try {
      const rows = await fetchListRows();
      // A list sent by the manager is at least as new as this one.
      if (!gotManagerList) applyList(cleanList(rows));
    } catch {
      if (gotManagerList) return;
      listState = "error";
      renderRows();
    }
  }

  // Under file:// the sender's origin is opaque ("null"; some browsers report "file://").
  function isTrustedOrigin(origin) {
    if (window.location.protocol === "file:") {
      return origin === "null" || origin === "file://";
    }
    return origin === window.location.origin;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    if (!isTrustedOrigin(event.origin)) return;

    const data = event.data;
    if (!data || data.type !== "status" || typeof data.text !== "string") return;
    statusEl.textContent = data.text;
  });

  // Sent by js/manage.js after it reads or changes the list:
  // detail = { pages: [...], status: "text" (optional) }
  document.addEventListener("pages-changed", (event) => {
    const detail = event.detail || {};
    gotManagerList = true;
    applyList(cleanList(detail.pages));
    if (typeof detail.status === "string") statusEl.textContent = detail.status;
  });

  nav.addEventListener("click", (event) => {
    const btn = event.target.closest(".nav-btn[data-page]");
    if (!btn) return;
    window.location.hash = btn.dataset.page;
  });

  // Switching the field shows that field's saved value (or the keyword); nothing is reset.
  filterField.addEventListener("change", syncControls);

  filterValue.addEventListener("change", () => {
    const column = currentField();
    if (column === KEYWORD_FIELD) return;
    criteria[column] = filterValue.value || FILTER_ALL;
    renderRows();
  });

  // "input" fires on each keystroke and on the search box's ✕.
  filterText.addEventListener("input", () => {
    keyword = filterText.value;
    renderRows();
  });

  // A button in the active-filter line removes just that filter.
  filterActive.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-field]");
    if (!button) return;
    const field = button.dataset.field;
    if (field === KEYWORD_FIELD) keyword = "";
    else if (FILTER_COLUMNS.includes(field)) criteria[field] = FILTER_ALL;
    else return;
    syncControls();
    renderRows();
  });

  filtersClear.addEventListener("click", () => {
    resetCriteria();
    filterField.value = "title";
    syncControls();
    renderRows();
  });

  window.addEventListener("hashchange", route);

  // Start clean (a reload can restore old form values into the controls).
  resetCriteria();
  filterField.value = "title";
  syncControls();
  setUploaded([]);
  // A link straight to an uploaded game (#<key>) waits for the list, instead of starting the
  // default game first. Everything else is shown at once.
  const startKey = window.location.hash.slice(1);
  const waitForList = CONFIGURED && !pageFromHash() && KEY_PATTERN.test(startKey);
  if (waitForList) {
    statusEl.textContent = LOADING_STATUS;
  } else {
    route();
  }
  loadList().then(() => {
    // Unless the user already went somewhere else meanwhile.
    if (waitForList && currentKey === null) route();
  });
})();
