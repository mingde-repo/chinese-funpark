# AGENTS.md

Rules for any AI coding agent (Codex, Cursor, Copilot, Claude, and others) working in this repo.

## 1. Project overview
明德中文乐园 (Mingde Chinese) is a small static website of Chinese learning games. A main page
(`index.html`) shows one game at a time inside an iframe: 中文冒险世界 (an adventure with six
levels) and 拼音泡泡大作战 (a pinyin bubble game with a teacher word-list manager). The nav
shows only these two plus a "…" button that opens the contents page (`#contents`): a grid of
thumbnail cards for the uploaded games, under a filter bar (field → value, or a keyword) whose filters add up. A teacher
can also upload, replace, edit and delete more game pages from the site itself (⚙ 管理). Those
games are stored in Supabase (Storage bucket `games` for the files, table `pages` for the list),
reached through its REST APIs with no SDK. They are not in this repo. It uses plain HTML, CSS and
JavaScript, with no build step and no framework.

## 2. File structure
```
index.html                main page: Supabase settings (<meta>), header (title, status, ⚙ 管理), nav (2 games + "…" +
                          open game's title), description line, iframe, contents page (#contents: filter bar + card
                          grid), Manage dialog
css/style.css             styles for the shell, the contents page and the dialog (light + dark tokens on :root)
js/main.js                main page logic: page map, hash routing, iframe swap (blob: URLs for uploaded games),
                          game list from Supabase, contents cards + filters
js/manage.js              ⚙ 管理 dialog: teacher sign-in, upload / replace / edit / delete via the Supabase REST APIs
pages/adventure-world.html  vendored game: 中文冒险世界 · 六大魔法关卡 (~19 MB, self-contained)
pages/pinyin-bubbles.html   vendored game: 拼音泡泡大作战 (~6 MB, self-contained)
README.md                 how to run the site, set up Supabase (SQL) and manage pages
AGENTS.md                 this file
CLAUDE.md                 Claude Code notes (points here)
```

Outside the repo, in Supabase: bucket `games` (`<key>_v<stamp>.html`, `<key>_v<stamp>.<ext>`) and
table `pages`.
Legacy, no longer used, to be deleted once the games are moved to Supabase (README → "Moving the
games"): `js/uploaded-pages.js` and `pages/uploads/`.

## 3. How to run
- Open `index.html` directly in a browser (double-click, or `start index.html` in PowerShell).
- Or use a static server from the project root, then open the printed URL:
  - `npx serve .`
  - `python -m http.server 8000` → http://localhost:8000
- Direct links: `index.html#adventure`, `index.html#bubbles`, `index.html#contents` (uploaded games),
  and `index.html#<key>` for an uploaded page.

## 4. Architecture rules
- **iframe shell:** `index.html` has a single `<iframe id="content" allow="autoplay">`. `js/main.js`
  owns a `BUILTIN_PAGES` map (`adventure`, `bubbles` → `src`, `title`, `description`, optional
  `author`), merges the
  uploaded pages into it, and is the only code that changes the iframe.
  `allow="autoplay"` must stay: the adventure game plays sound in its own inner iframe.
- **Hash routing:** the current page lives in the URL hash (`#adventure`, `#bubbles`,
  `#contents`, `#<key>`). One delegated click listener on the nav sets the hash, and a
  `hashchange` listener loads the page. Default is `adventure`. Each load swaps in a fresh iframe
  so the hash is the only browser history entry. The open page's `description` and `author` are
  shown in `#page-desc` under the nav, as "description · 作者：author". A start-up hash for an
  uploaded game waits for the list (instead of loading the default game first); an unknown one
  then falls back to `adventure`.
- **Uploaded games in the iframe:** Supabase Storage serves `.html` as `text/plain`, so an uploaded
  game is never the iframe's `src` directly. `main.js` fetches it (the row's `file`), makes a
  `blob:` URL of type `text/html;charset=utf-8`, and sets that as the fresh iframe's `src`, with
  "加载中… / Loading…" in the status line meanwhile. If the fetch fails (the file was replaced
  after this page read the list), `loadGame` reads the list again once and opens the new file;
  if the game was deleted, the list change sends the page to the default. A result that arrives
  after the user moved on is dropped (`loadRun`), and the old blob URL is revoked on every page change. When the blob is
  ready, `loadGame` swaps in **another** fresh iframe whose first page is the blob (never a later
  `src` change on the empty one), so no history entry is added. Over http(s) a blob page has the
  shell's origin, so a game's localStorage and the postMessage check work as before. Under
  `file://` the blob page's origin is opaque (`null`): the game runs and its messages are accepted,
  but **localStorage throws `SecurityError`** there, so uploaded games can't save teacher settings
  when the site is opened from disk.
- **Nav and contents page:** the nav has only the built-in game buttons and the "…" button
  (`data-page="contents"`). Uploaded games get no nav button. `#contents` hides the iframe
  (emptied, so game sound stops) and shows `#contents-view`: a filter bar and a grid of cards
  (`#contents-grid`), both built by `main.js`. It lists only the uploaded games (the built-in
  ones have their own nav buttons); with none, it says "还没有上传的游戏" (or that the list is
  loading, couldn't be read, or that Supabase isn't set up yet: `EMPTY_TEXT`).
  - Filter bar: `#filter-field` picks a field (Title, 教材/Textbook, 册/Volume, 课/Lesson, Author,
    关键词/Text; default Title), and next to it is that field's control. For the first five it is
    `#filter-value`: "全部 / All" plus the values of that field found in the games that pass the
    other fields' values and the keyword (the chosen value always stays listed). For 关键词/Text
    (`KEYWORD_FIELD`) it is `#filter-text` instead (only one of the two is shown): one keyword that
    the title, description, textbook, volume, lesson or author must contain (case-insensitive; a
    lesson matches `3` and 第三课). Each field keeps its own value in `criteria`, and the keyword is
    kept apart, so the filters add up: a card is shown only when it passes the value of every field
    and the keyword. Switching the field shows that field's saved setting. `#filter-active` lists
    each filter that is set as a button ("作者 = 王老师 ✕", "关键词 包含 “3” ✕") that removes it.
    "Clear filters" resets everything. Filters are not kept across a reload.
  - Card: a link (`href="#<key>"`) with a 4:3 thumbnail and the title under it, nothing else. Its
    tooltip holds the description, "textbook · volume · lesson", "作者：author" and the HTML file
    name. The thumbnail is `<SUPABASE_URL>/storage/v1/object/public/games/<thumb>` (no `?v=`).
    Without a picture, or if it fails to load, it is a colored tile with the title's first
    character; the color (`--tile-0` … `--tile-5`) is picked from the key. The "…" button is marked active on
  `#contents` and on uploaded games. While an uploaded game is open, its title is shown right after
  "…" in the nav (`#nav-current`, a plain label, not a button). `contents` is a reserved key.
- **Uploaded pages (⚙ 管理):**
  - **Supabase project:** set once in two `<meta>` tags in `index.html`
    (`mingde-supabase-url`, `mingde-supabase-anon-key`), read by both scripts. The anon /
    publishable key is public by design. The `service_role` / secret key never goes in the repo.
    The setup SQL (table, bucket, policies: anyone reads, `authenticated` writes) is in `README.md`.
    Without the two values, the site shows the built-in games and says Supabase isn't set up.
  - **Versioned file names:** every file is saved under a name that is never reused:
    `<key>_v<stamp>.<ext>` (`VERSIONED_NAME`), where `<stamp>` is the save time as 14 digits (UTC,
    `versionStamp()`) and `<ext>` is `html`, `png`, `jpg` or `webp`. A file never changes under its
    name, so no browser or CDN can serve an old version, and links need no `?v=`. Keys can't
    contain `_`, so `<key>_` starts the names of that game's files only. The save time, not a
    counter, keeps names unique even when a deleted key is uploaded again (a device may still have
    the deleted game's file cached). The page link `#<key>` never changes.
  - Files live in the public bucket `games`. The list is the table `pages`, one row
    `{ key, file, title, description, textbook, volume, lesson, author, thumb, updated }` per game
    (`updated` is a timestamptz). `file` is the current game file name and is required (a row
    without a valid one is not listed). `thumb` is the current picture's file name, or `""` (also
    when missing) for no picture. Both must belong to the row's key (`cleanFileName`). Key `^[a-z0-9][a-z0-9-]{0,39}$`, not a
    built-in key, not `contents` and not `manage`. Title 1–40 characters. Description 0–200 characters.
    Textbook (教材, e.g. 人教语文) 0–40 characters. Volume (册, e.g. 二年级上册) 0–20 characters.
    Lesson (课) a whole number 1–999, or `null` when empty; it is shown as 第三课 (Chinese numerals
    up to 99, digits from 100) and sorts by number. Author 0–40 characters. All are set in the
    Upload and Edit forms. Missing text fields read as `""` and a missing lesson as `null`.
    `cleanList` (main.js) / `cleanEntries` (manage.js) still read an old `book` text as the
    textbook. `main.js` and `manage.js` each have their own copy of the lesson-label helper.
  - `main.js` reads the list once at start-up (`GET /rest/v1/pages?select=*&order=key`, anon key
    only). `manage.js` reads it again each time the dialog opens and after each change.
  - `js/manage.js` calls the Supabase REST APIs through its own `nativeFetch`: Storage
    (`/storage/v1/object/…`), PostgREST (`/rest/v1/pages`) and Auth (`/auth/v1/token`). Uploads
    use `x-upsert: false` (a name is never overwritten; two saves in the same second give the
    second one a 409, "please try again") and `cache-control: max-age=2592000` (`CACHE_SECONDS`,
    30 days). That cache time only matters for deleted games: a device that played one may keep
    its copy that long. Changes are live at once; there is no publishing wait. Each operation
    uploads the **new files first, then switches the row to them, then deletes the old files**:
    - Upload/Replace: new HTML, then new picture (if any), then upsert the row with the new names
      (`Prefer: resolution=merge-duplicates,return=representation`), then delete the old version.
    - Edit: new picture (if any), then `PATCH` the row. The game file keeps its name, so devices
      don't download the game again. Leaving the picture empty keeps the current one; Edit can
      also remove it.
    - If the row can't be saved, the files just uploaded are removed again (`saveRow`, best effort).
      If deleting the old files fails, the save still counts and the dialog shows a warning
      (`dropOldFiles`).
    - Delete: delete every `<key>_…` file in the bucket (`filesOf`, all versions, including any an
      earlier failed cleanup left), then the row. If a step fails, the game stays listed and
      pressing Delete again finishes the job.
  - **Check every write (RLS answers 200 when it blocks):** a blocked Storage delete lists nothing,
    and a blocked `PATCH`/`DELETE` returns no rows. `removeFiles` looks up every name missing from
    the delete answer (`POST /storage/v1/object/list/games`) and throws `FILES_NOT_DELETED` if one
    still exists; already-gone files (a retry) are fine. Row writes use
    `Prefer: return=representation`, and an empty answer for a row that still exists throws
    `ROW_NOT_SAVED`.
  - Storage errors can come back as HTTP 400 with the real status in `statusCode`; `apiError`
    uses that one.
  - `manage.js` and `main.js` talk only through the DOM event
    `document.dispatchEvent(new CustomEvent("pages-changed", { detail: { pages, status } }))`.
  - User text (titles, descriptions, textbooks, volumes, authors) is only ever shown with `textContent` or attributes,
    never with `innerHTML`.
  - Picture limits: `.png`, `.jpg`/`.jpeg` (saved as `jpg`) or `.webp`, not empty, at most
    `THUMB_MAX_MB` (1).
  - Thumbnails from the game: the game's HTML is searched **as text** (its scripts never run) for
    embedded `data:image/png|jpeg|webp|gif;base64,…` pictures (also with `\/` from JS/JSON strings).
    Small ones (icons) are skipped and duplicates dropped. The biggest, up to `THUMB_CHOICES_MAX` (6),
    are cropped to 4:3 on a canvas (tall: keep the top; wide: keep the middle), scaled to 640×480
    and saved as WebP (JPEG where the browser can't write WebP). They show as buttons under the
    form (`#upload-thumb-pick` / `#edit-thumb-pick`), plus a last "No picture" / "Keep current".
    - Upload: runs when a game file is chosen. The first thumbnail is preselected, except when
      replacing a game that already has a picture (then "Keep current").
    - Edit: "从游戏生成 / From the game" loads the row's `file` from the bucket's public URL.
    - Which picture is saved: a picture file chosen by hand, then (Edit) "Remove the picture",
      then the chosen thumbnail; with none of them the current picture is kept.
  - Upload limits: `.html`/`.htm`, not empty, at most `MAX_UPLOAD_MB` (50, also the bucket's
    `file_size_limit` and Supabase's free-plan maximum). The file must be self-contained: linked
    images or scripts are not uploaded.
- **Teacher sign-in (Supabase Auth):**
  - Email + password → `POST /auth/v1/token?grant_type=password`. The session
    `{ access_token, refresh_token, expires_at, email }` is kept in memory by default.
    "Remember on this device" stores it in localStorage under `mingde.supabaseSession`. It is
    refreshed (`grant_type=refresh_token`) 60 s before it expires; if that fails, the teacher is
    signed out. Sign out also calls `/auth/v1/logout` (best effort). The old
    `mingde.githubToken` entry is removed on load.
  - Accounts are made by the admin in the Supabase dashboard; public sign-ups are turned off.
  - Signed out, calls carry only the `apikey` header (read only). Signed in, they add
    `Authorization: Bearer <access token>`.
  - `main.js` and `manage.js` each keep their own `fetch` reference, taken before any game page loads.
  - Uploaded pages run on the same origin, so they could read a remembered session. Only trusted
    pages should be uploaded.
  - Never put a password, a session or the `service_role` key in a file or a commit.
- **Vendored game pages:** the files in `pages/` are self-contained templates (inline scripts,
  embedded audio and images, localStorage for teacher mode). Keep them as delivered: don't edit,
  reformat or split them unless asked. Don't Read them whole (19 MB / 6 MB). Search them with
  grep instead. They are exempt from the one-JS-file and no-inline-script rules below.
- **New authored pages** (if any are added) are complete HTML documents that load their own
  `<script src="../js/<name>.js" defer></script>` and link `../css/style.css`.
- **No shared globals:** every authored script is wrapped in an IIFE. Pages never read each other.
  Shared settings come from the DOM (the Supabase `<meta>` tags), not from globals.
- **Messages between pages (optional):** a page can tell the main page something with
  `window.parent.postMessage({ type: "status", text }, targetOrigin)`. `main.js` accepts a
  message only when `event.source` is the current iframe and `event.origin` is trusted
  (the page's own origin over http, or `"null"` / `"file://"` under `file://`; blob: games have
  the shell's origin). The two games don't send any, so the header status line stays empty for them.
- **file:// compatible:** no `fetch()` of local files, no ES modules (`type="module"`),
  no `import`/`export`. `fetch()` is used only for the Supabase project (remote https): in
  `main.js` for the list and the uploaded games, in `manage.js` for the REST APIs and for Edit →
  "From the game".
- **No build step, no npm dependencies, no external CDNs, no Supabase SDK** (plain REST calls).

## 5. Coding conventions (authored files)
- Semantic HTML5 (`header`, `nav`, `main`, `section`, real `<button>`s); `lang="zh-Hans"`
  on Chinese text.
- Vanilla ES2020, `"use strict";` at the top of every JS file, `const`/`let` only (no `var`).
- `addEventListener` only. No inline `onclick` or other inline handlers.
- 2-space indent. kebab-case ASCII file names. camelCase JS names. UPPER_CASE for constants.
- Colors come from CSS custom properties in `css/style.css`. Don't hard-code colors elsewhere.

## 6. Adding a page (checklist)
Normally a teacher adds a page from the site: ⚙ 管理 → Upload. Nothing in the code changes.
To add a new **built-in** page (fixed, can't be deleted from the site):
1. Put the file in `pages/` with a kebab-case ASCII name (rename vendored files; don't edit them).
2. Pick a short hash key, e.g. `story`. It must not be used by an uploaded page, and not be
   `contents` or `manage`.
3. In `index.html`, add `<button type="button" class="nav-btn" data-page="story" data-builtin>…</button>`
   before the "…" button (`data-page="contents"`).
4. In `js/main.js`, add `story: { src: "pages/<file>.html", title: "…", description: "…" }` to
   `BUILTIN_PAGES` (optionally also `author: "…"`). Built-in games are not listed on the
   contents page.
5. Update the file lists in `README.md` and in section 2 of this file.

## 7. Testing
- Open `index.html` in Chrome and in Edge, both from `file://` and from a static server.
- DevTools console must show no errors from `index.html` / `main.js`.
- Click both nav buttons. The hash, the active button and the iframe all change together.
- Reload on `#bubbles` and you stay there. Back/Forward moves between pages.
  A bad hash (e.g. `#nope`) falls back to `#adventure`.
- Start a level in each game. Sound plays after the first click.
- Check a 375px-wide viewport (DevTools device mode): the nav wraps and there's no horizontal scroll.
  The header stays on one row with ⚙ 管理 at the right end. The open dialog fits the screen.
- Each game shows its description under the nav, followed by "· 作者：…" when it has an author.
- "…" opens `#contents`: a card for every uploaded game and none for the built-in ones, each with
  a thumbnail (the picture, or a colored tile with the title's first character) and only the title.
  Hovering a card shows its description, textbook · volume · lesson and author. The filter bar has
  Field (Title, 教材/Textbook, 册/Volume, 课/Lesson, Author, 关键词/Text) and, next to it, Value.
  Pick Field = Author and a value: the cards narrow and "作者 = … ✕" appears under the bar. Switch
  Field to Lesson: the values show as 第三课, sort by number and are only that author's lessons.
  Switch Field to 关键词/Text: Value is replaced by a text box; typing `3` or 三 narrows the cards
  (as you type) to that author's lesson 3 (a word from a description works too), and
  "关键词 包含 “3” ✕" appears. Back on Lesson, the Value list has shrunk to match. Switching back
  to Author still shows the chosen author, and back to 关键词 still shows the typed text. ✕ on one
  button removes only that filter. "Clear filters" resets everything (Field back to Title) and
  shows all again; it is disabled when nothing is set. Clicking a card opens its game (with "…"
  still highlighted for uploaded games, and the game's title right after "…"; the title disappears
  on `#contents` and the built-in games). At 375px Field and Value (or the text box) share a row,
  the cards are 2 per row, and there's no horizontal scroll.
- Uploaded games: opening a card shows "加载中…", then the game runs (not shown as source code),
  sound plays after a click, and over http(s) its teacher-mode settings survive a reload (under
  `file://` they can't be saved; see "Uploaded games in the iframe"). A direct link
  `index.html#<key>` opens that game without first loading 中文冒险世界. With the two `<meta>` values
  empty, the built-in games still work and `#contents` says Supabase isn't set up.
- Pictures: upload a game with a picture and its card shows it; Replace without choosing a picture
  keeps it; Edit with a new `.jpg` replaces a `.png` (the old file is gone from the bucket); Edit →
  "Remove the picture" brings back the tile; Delete removes both files. A `.gif` or a picture over
  1 MB is refused.
- Versions: after Upload the bucket has `test_v<stamp>.html` (and a picture with the same stamp).
  Replace makes a new stamp: the bucket then holds only the new files, the row points at them,
  and the game shows the new version straight away. Edit of the title only keeps `file` unchanged.
  With the contents page open in a second tab, Replace the game in the first tab, then click its
  card in the second tab: the new version opens (the stale link is retried with a fresh list).
- Thumbnails from the game: choosing `rj-2a-3-adventure.html` in Upload shows one thumbnail (the top
  of its title map) and "No picture"; the thumbnail is preselected and clicking switches the outline.
  A game without embedded pictures says none was found. Edit → "From the game" does the same from
  the bucket (from `file://` too). Choosing a picture file by hand wins over the thumbnail.
- ⚙ 管理 signed out: the list is visible, Upload is disabled, and Edit or Delete asks you to sign in.
  A wrong password says "邮箱或密码不对". Signed in, Upload stays disabled until a file is chosen and
  Key and Title are filled (its tooltip says what's missing); clearing any of them disables it
  again. Clear empties every Upload field (it doesn't bring back the example values). "Remember on
  this device" keeps you signed in after a reload; without it a reload signs you out.
- Test uploads with a throwaway key (e.g. `test`). Each action shows up at once on `#contents` and
  in the Supabase dashboard (table `pages`, bucket `games`). Delete it again afterwards.
- Delete check: temporarily turn off the bucket's delete policy, then Delete `test`. The dialog
  shows "文件没有被删除…", and the game stays in the list and in the bucket. Turn the policy back
  on and Delete again: the files and the row are gone.

## 8. Don'ts
- No frameworks (React, Vue, …), bundlers (Vite, webpack, …), or transpilers.
- No inline `<script>` blocks or inline event handlers in authored files (vendored games excepted).
- Don't edit a vendored game page while working on the shell, or the shell while working on a page.
- Don't add globals, `fetch()` of local files, ES modules, or the Supabase JS SDK.
- Never commit a password, a session, or the Supabase `service_role` / secret key.
- Don't set an uploaded game's Storage URL as the iframe `src` (it is served as text/plain).
- Don't overwrite or reuse a file name in the bucket: a changed file always gets a new
  `<key>_v<stamp>` name.
- Don't trust a 200 from a Supabase write on its own: RLS blocks silently, so check the answer.
- Don't use `innerHTML` with page titles, descriptions, textbooks, volumes or authors.
