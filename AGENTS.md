# AGENTS.md

## 0) Purpose
This file defines project rules and working conventions for any automated coding agent.
Follow these rules strictly to avoid accidental breakage, noisy diffs, or security leaks.

### Project stack (essential)
- Frontend: **React 19 + TypeScript + Vite 6** (`@vitejs/plugin-react`)
- UI/Styling: **Tailwind CSS via CDN** (`cdn.tailwindcss.com`, NOT installed via npm) + **Google Fonts**
- Charts: **Recharts**
- AI integration: **@google/genai (Gemini)**, default model: **gemini-2.5-flash**
- Backend: **Node.js built-in `http` server** (NOT Express), provides `/api/log/*`
- Data storage:
  - Frontend local: **IndexedDB**
  - Backend persistence: `*.log` (**JSONL**, one JSON per line)
- Testing: **Vitest** + Testing Library (`@testing-library/react`, `@testing-library/jest-dom`)
- Dev tooling: **concurrently** + **npm scripts**

Package manager: **npm**  
Node version: **v24.12.0**  
Code formatter: **none (do not introduce mass formatting changes)**

---

## 1) Repository Layout (high-level)
Common directories at repo root:
- `components/`     : React UI components
- `services/`       : shared service modules (e.g., data access, external APIs)
- `utils/`          : shared utilities/helpers
- `tests/`          : test sources executed by Vitest (`tests/**/*.test.ts`, `tests/**/*.test.tsx`)
- `server/`         : backend server code (entry: `server/index.js`)
- `data/logs/`      : runtime logs (e.g., `flow.log`, `flow.snapshots.log`) — not source code

Common root files:
- `index.html`, `index.tsx`, `App.tsx` : frontend entry
- `vite.config.ts`                    : Vite config
- `tsconfig.json`, `tsconfig.test.json`
- `package.json`, `package-lock.json`, `README.md`
- `types.ts`, `metadata.json`

---

## 2) No-touch Areas (unless explicitly approved)
Do not manually edit, and do not include changes to these paths in commits unless the user explicitly approves:

- `dist/`
- `data/` (including `data/logs/`)
- `.test-dist/`
- `node_modules/`

Notes:
- `dist/` and `.test-dist/` are build/test outputs. You may generate them via scripts, but never edit them directly.
- `data/` contains runtime data/logs. Do not commit local data changes.
- `node_modules/` is always excluded from version control.

---

## 3) Package Manager and Lockfile Rules
- Use **npm** only (not pnpm/yarn).
- Do not modify dependencies unless the task requires it.
- `package-lock.json` should only change when:
  - dependencies are intentionally added/updated/removed, OR
  - the user explicitly approves lockfile refresh.
- Avoid incidental lockfile churn.

---

## 4) Commands (use project scripts)
### Development
- Run web + server together: `npm run dev`
  - Web: `vite`
  - Server: `node server/index.js`
- Server only: `npm run dev:server`
- Web only: `npm run dev:web`

### Build / Preview
- Build: `npm run build`
- Preview: `npm run preview`

### Tests
- Run tests: `npm test` (`vitest run`)
- Coverage (strict 100% thresholds for selected includes): `npm run test:coverage` (`vitest run --coverage`)
- Optional helper (not part of `npm test`): `npm run test:prepare` (compiles test targets to `.test-dist/`)

Important:
- `.test-dist/` is generated; never edit it directly.

---

## 5) Required Workflow (must follow)
### (A) Plan before code changes
Before editing any code, provide a plan of **3–6 bullet points** including:
- which files will be changed (relative paths),
- what will be changed in each file,
- how the change stays minimal (avoid opportunistic refactors).

If you believe a refactor is necessary, stop and explain why, plus alternatives, and wait for approval.

### (B) Keep changes minimal and consistent
- Preserve existing naming conventions, folder structure, and error-handling style.
- Do not “clean up” unrelated code.
- Do not reformat large files (there is no formatter configured; avoid whitespace-only diffs).

---

## 6) Testing and Verification (mandatory)
You must verify every code change unless there is a concrete blocking reason.

Minimum required commands after changes:
1) `npm test`  
2) `npm run build`

Notes:
- `npm test` ensures Vitest test suites pass.
- `npm run build` ensures the frontend bundles correctly and catches TypeScript/Vite build-time issues.

If coverage is relevant to the modified area (or requested):
- `npm run test:coverage`

If you cannot run the required commands:
- clearly state why (environment limitation, missing runtime dependency, etc.),
- provide substitute verification steps (e.g., TypeScript compile checks, manual verification steps),
- and highlight risk.

---

## 7) Security and Secrets (mandatory)
Never hardcode or commit:
- tokens, API keys, credentials,
- internal/private URLs or endpoints.

If secrets/config are needed:
- use environment variables,
- update `.env.example` with variable names and safe placeholders (never real values).

If you discover existing secrets in the repository:
- do not propagate them to new files,
- notify the user and suggest moving them to env vars.

---

## 8) Response Format (every delivery must include)
When you finish, your response must include these sections:

1. **Summary of changes**
   - 3–8 bullets describing what was done and why.

2. **Files changed**
   - list every modified/added/deleted file path.

3. **How to verify**
   - list commands actually run (must include `npm test` and `npm run build`),
   - or explain why not run + alternative checks.

4. **Explanation for a baseline engineer**
   - Explain in plain English (for an engineer with average fundamentals):
     - what you changed,
     - where you changed it (key files/modules),
     - and why this approach was chosen.

5. **Risks and rollback**
   - what might break,
   - the simplest rollback (e.g., revert specific files/commit, restore previous logic).

---

## 9) Node Version Requirement
- Target runtime: **Node v24.12.0**
- Avoid introducing features that require a different Node major version without approval.
