# 明德中文乐园 (Mingde Chinese)

A small static website of Chinese learning games. It has no build step and no dependencies.

- **中文冒险世界** (`#adventure`): an adventure with six magic levels, plus a teacher mode.
- **拼音泡泡大作战** (`#bubbles`): a pinyin bubble game with a teacher word-list manager.
- **目录 / Contents** (`#contents`, the **…** button): a card for each uploaded game, showing its
  thumbnail picture (or a colored tile with the title's first character) and its title. Hover over a
  card to see its description, textbook, volume, lesson and author. Click a card to open the game;
  its title then shows next to the **…** button. Above the cards, pick a field (title, 教材 /
  textbook, 册 / volume, 课 / lesson, author), then one of its values. Or pick 关键词 / Text and
  type a keyword that the title, description, textbook, volume, lesson or author must contain
  (a lesson matches both `3` and 第三课). Filters add up, e.g. one author's lesson 3. The filters
  that are set are listed under the bar; click ✕ on one to remove it.

## Run it

Open `index.html` in a browser. Or serve the folder from the project root:

```powershell
# PowerShell or Git Bash
npx serve .
# or
python -m http.server 8000   # then open http://localhost:8000
```

You can link straight to a game with `index.html#adventure`, `index.html#bubbles`, or
`index.html#<key>` for an uploaded game, and to the contents page with `index.html#contents`.

## Add, change or remove games (⚙ 管理)

Teachers can add more games straight from the website. The games are stored in
[Supabase](https://supabase.com): the files in a Storage bucket, the list in a database table.
A change is live for every visitor **at once**. The code in this repo doesn't change.

**1. Set up Supabase (once, by the site admin).** See [Supabase setup](#supabase-setup) below.

**2. Sign in on the site.** Click **⚙ 管理** (top right), enter your email and password and press
**Sign in**.
- The sign-in is kept only for this visit, unless you tick **Remember on this device**.
- Never share your password, and never put it in a file.
- Uploaded pages run on the same site as the sign-in, so only upload pages you trust.

**3. Manage pages.**
- **Upload:** choose an `.html` file (at most 50 MB). Enter a **key**: a–z, 0–9 and `-`. It is
  used in the link `#key` and in the file name, and can't be changed later. Enter a **title**,
  an optional **description**, and optionally the **教材 / textbook** (e.g. 人教语文), the
  **册 / volume** (e.g. 二年级上册), the **课 / lesson** as a number (3 is shown as 第三课), the **author** and a **缩略图 / thumbnail
  picture** (PNG, JPG or WebP, at most 1 MB; a 4:3 landscape picture fits best).
  You usually don't need your own picture: after you choose the game file, the site makes
  thumbnails from the pictures inside the game and shows them under the form. The first one is
  already chosen; click another one or **No picture** to change it. A picture file you choose
  yourself is used instead.
  The form starts filled in with example values (key `rj-2a-3-adventure`, title 中文冒险世界,
  description 六大魔法关卡，闯关学中文, textbook 人教语文, volume 二年级上册, lesson 3, author 王老师). Change them as
  needed, or press **Clear** to empty every field. Choosing a file replaces the example key with the file name, unless you
  typed your own key. The **Upload** button works only once you are signed in and the file, key
  and title are filled in; hover over it to see what's missing. Uploaded games appear as cards on the contents page (**…**), not as
  their own button. While the game opens, the line under the buttons shows "description · 作者：author".
- **Edit:** change the title, description, textbook, volume, lesson or author, choose a new
  picture, press **从游戏生成 / From the game** to make thumbnails from the game (it loads the game
  from storage), or tick **Remove the picture**. The game file isn't uploaded again.
- **Replace:** upload a new version of the file under the same key. If the game already has a
  picture, **Keep current** is chosen; click a thumbnail to use it instead.
- **Delete:** removes the game file, its picture and its list entry, for good (Supabase Storage
  has no trash). The files are deleted first and the list entry last, and the site checks that the
  files are really gone. If a step fails, the game stays in the list with an error message, and
  pressing **Delete** again finishes the job. A device that played the game in the last 30 days
  may still have a copy in its browser cache.
- **Links never change, and nobody gets an old version.** A game's link (`index.html#key`) stays
  the same forever. Behind it, every upload or new picture is saved under a new file name
  (e.g. `rj-2a-3-adventure_v20261116090000.html`) and the list points at the newest one, so no
  browser or CDN can show an old version. The old files are deleted straight after. A student
  who had the contents page open during a Replace still gets the new version.
  Editing only the details (title, author, …) keeps the game file, so devices don't download it again.
- The built-in games (中文冒险世界, 拼音泡泡大作战) can't be changed here.

**Limits**
- An upload must be **one self-contained HTML file**. Pictures, sounds or scripts it links to
  are not uploaded.
- At most 50 MB per file (also the limit of Supabase's free plan).
- **Download traffic:** every play downloads the whole game (often 6–19 MB). Supabase's free plan
  includes only a few GB of traffic a month, roughly 50 plays per GB. Check the current plans at
  supabase.com/pricing. Devices keep each game file for up to 30 days, so a repeat play on the
  same device usually comes from the browser cache.

## Supabase setup

Do this once. The code reads the project from two `<meta>` tags at the top of `index.html`.

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → New query → paste the SQL below → **Run**. It creates the list table, the
   bucket, and the rules: anyone may read, and only signed-in users may write.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up", so nobody
   can make their own account. **Authentication → Users → Add user**: add each teacher (email and
   password, with "Auto Confirm User" ticked).
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into
   `index.html`:

   ```html
   <meta name="mingde-supabase-url" content="https://<your-project>.supabase.co">
   <meta name="mingde-supabase-anon-key" content="<anon or publishable key>">
   ```

   Both are public by design. **Never** put the `service_role` / secret key in a file.
5. Commit and push. Then sign in on the site (⚙ 管理) and upload the games.

```sql
-- The list of uploaded games (one row per game). `file` and `thumb` are the names of the game's
-- current files in the bucket. Every new version gets a new name: <key>_v<save time>.<ext>.
create table public.pages (
  key         text primary key check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  file        text not null check (file ~ '^[a-z0-9][a-z0-9-]{0,39}_v[0-9]{14}\.html$'),
  title       text not null check (char_length(title) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  textbook    text not null default '' check (char_length(textbook) <= 40),
  volume      text not null default '' check (char_length(volume) <= 20),
  lesson      int check (lesson between 1 and 999),
  author      text not null default '' check (char_length(author) <= 40),
  thumb       text not null default ''
              check (thumb = '' or thumb ~ '^[a-z0-9][a-z0-9-]{0,39}_v[0-9]{14}\.(png|jpg|webp)$'),
  updated     timestamptz not null default now()
);
alter table public.pages enable row level security;
create policy "Anyone can read the list" on public.pages
  for select using (true);
create policy "Teachers can change the list" on public.pages
  for all to authenticated using (true) with check (true);

-- The public bucket for the game files and pictures, at most 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('games', 'games', true, 52428800);
-- Reading is also needed for the check that a deleted file is really gone.
create policy "Anyone can read the games bucket" on storage.objects
  for select using (bucket_id = 'games');
create policy "Teachers can upload games" on storage.objects
  for insert to authenticated with check (bucket_id = 'games');
create policy "Teachers can replace games" on storage.objects
  for update to authenticated using (bucket_id = 'games') with check (bucket_id = 'games');
create policy "Teachers can delete games" on storage.objects
  for delete to authenticated using (bucket_id = 'games');
```

**Moving the games from the old version (once).** Before Supabase, uploaded games were files in
this repo. Upload each file in `pages/uploads/` again through ⚙ 管理, with the same key, title
and other fields as in `js/uploaded-pages.js`. Then delete `js/uploaded-pages.js` and
`pages/uploads/`, and commit.

## Files

```
index.html                  main page: Supabase settings (<meta>), header (⚙ 管理), nav (2 games + … + open game's title),
                            description line, iframe, contents page (filters + cards), Manage dialog
css/style.css               main page styles (light + dark)
js/main.js                  switches games via the URL hash; reads the game list from Supabase; builds the cards and filters
js/manage.js                ⚙ 管理: teacher sign-in; upload / replace / edit / delete through the Supabase APIs
pages/adventure-world.html  中文冒险世界 (self-contained, ~19 MB)
pages/pinyin-bubbles.html   拼音泡泡大作战 (self-contained, ~6 MB)
```

Uploaded games are not in the repo. They are in Supabase: `<key>_v<save time>.html` and its
picture in the Storage bucket `games`, and the list (with the current file names) in the table `pages`. Until you have moved them (see above),
the old `js/uploaded-pages.js` and `pages/uploads/` are still here, but the site no longer uses them.

## Teacher data

Both games save teacher settings and word lists in the browser's localStorage. The data
stays in the browser and computer where it was saved. Opening the site from disk (`file://`)
and through a server (`http://localhost`) use **separate** storage, so word lists saved in one
won't appear in the other.

Uploaded games can save their settings only when the site is opened through a web address (the
live site, or `npx serve .` / `python -m http.server 8000`). Opened from disk (`file://`), they
still run, but the browser blocks their storage, so nothing they save is kept.

See [AGENTS.md](AGENTS.md) for the architecture rules and how to add a page.
