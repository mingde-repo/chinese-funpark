See @AGENTS.md for the full project rules.

# CLAUDE.md: Claude Code notes

## Working style
- Use the file-editing tools (Read/Edit/Write), not shell redirection, to change files.
- Keep each change small. Navigation changes touch only `index.html` / `js/main.js`, and shell
  styles only `css/style.css`.
- The game pages in `pages/` are vendored and huge (~19 MB / ~6 MB). Never Read them whole.
  Use Grep with a narrow pattern. Don't edit them unless the user asks.
- Uploaded games live in Supabase (bucket `games`, table `pages`), not in the repo, and the site
  no longer commits to `main`. You can't see or test them without the project's two `<meta>`
  values in `index.html`. Never ask for or write down a password, a session or the
  `service_role` key. `js/uploaded-pages.js` and `pages/uploads/` are legacy, kept only until the
  games have been moved to Supabase.
- After a change, list the files changed and say exactly how to check it in the browser
  (which page, what to click, what should happen).

## Environment
- Windows. When giving commands, show both forms:
  - PowerShell: `start index.html` · `npx serve .` · `python -m http.server 8000`
  - Git Bash: `start index.html` · `npx serve .` · `python -m http.server 8000`

## Ask first
- Before adding any dependency, build step, or new top-level folder.

## Keep docs in sync
- When the file structure changes, update `AGENTS.md` (section 2, plus section 6 if the
  steps change) and `README.md` in the same change.
