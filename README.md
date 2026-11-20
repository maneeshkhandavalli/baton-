# Baton

Baton turns a team's chats and documents into a handover for the next person. Every decision, owner, task and risk
links back to the exact message it came from, and is marked Sourced, Inferred, Conflicting or Missing. A human
reviews every point before anyone else sees it. Built for student clubs, project teams and volunteer groups that
change people every term.

* **Live app:** https://baton-seven-alpha.vercel.app
* **Demo without an account:** https://baton-seven-alpha.vercel.app/demo
* **Submission summary and honest status:** [`docs/submission/SUBMISSION.md`](docs/submission/SUBMISSION.md),
  [`docs/status/STATUS.md`](docs/status/STATUS.md)

## Try it in 30 seconds

1. Open **/demo**. No sign-in. Follow the guided steps: sources, review, publish, and what the incoming member sees,
   including the decision timeline. The demo runs in your browser and makes no AI calls.
2. For the real app, open **/login** and choose **Continue with Google**. (Email and password sign-up exists, but our
   email sender only reaches team addresses, so confirmation emails will not arrive for you.)
3. **New handover** → fill in the details → accept the consent statements → **Use sample data** → **Start processing**.
   Keep the Processing page open until the run finishes. Processing uses real AI (Omega Plus gateway,
   `claude-sonnet-5-5` to extract, `claude-sonnet-5` to verify).
4. **Review**: open a point to see its quotes, approve or edit it, then **Publish**. Open the **Published** and
   **Timeline** tabs.
5. Optional: **Settings** → create an invitation link, copy it, and open it in another browser signed in as a second
   account to see the incoming member's view. **Settings → Start a revision** shows the Living Handover flow.

Connected channels: the Telegram connector was verified live with a real group on a local stack. GitHub, Discord and
Slack connectors are built but not verified live. None are configured on the deployed site, where they show "Not set
up on this server".

## Run it locally

Verified on 2026-11-20 on Windows 11 with Node 24.14: a fresh `git clone` of `master`, `npm ci` (about 35 s) and
`npm test` (2,916 tests passed, 1 todo, 0 failed, about 1 min 40 s).

### Prerequisites

* **Node.js 24** with npm (tested with 24.14; Next.js 16 needs at least 20.9). There is no `.nvmrc` or `engines` field.
* **Docker** (Docker Desktop on Windows and macOS), running. The local Supabase stack and some tests use it.
* **Supabase CLI 2.122.1**, run through `npx supabase@2.122.1` (no global install needed).
* **Git**. On Windows, Git Bash is needed only for the optional SQL suites (`npm run test:sql`).

### 1. Clone and install

```bash
git clone https://github.com/maneeshkhandavalli/baton-.git baton
cd baton
npm ci
```

### 2. Start a local Supabase stack (applies the migrations)

```bash
npx supabase@2.122.1 start
npx supabase@2.122.1 status
```

`start` creates the local stack described in `supabase/config.toml` (Postgres 17, Auth, Storage) and applies every
file in `supabase/migrations/` (57) to its fresh database. `status` prints the API URL (normally
`http://127.0.0.1:54321`) and the keys you need in the next step. If you already had this stack from an older
checkout, `npx supabase@2.122.1 migration up` applies only the new migrations, and `npx supabase@2.122.1 db reset`
rebuilds the local database from scratch (this deletes local data).

### 3. Create `.env.local`

```bash
cp .env.example .env.local
```

Then set these values (everything else in `.env.example` can stay empty for a local run):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the API URL from `supabase status` (e.g. `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key (or publishable key) from `supabase status` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (or secret key) from `supabase status`; server only |
| `BATON_SITE_URL` | `http://localhost:3000` (already set in the example) |
| `IDENTITY_PEPPER`, `IDENTITY_PEPPER_CANARY` | generated below; `IDENTITY_PEPPER_VERSION=p1` is already set |
| `IDENTITY_MAP_KEY` | generated below; `IDENTITY_MAP_KEY_VERSION=k1` is already set |
| `CRON_SECRET` | generated below (at least 32 characters) |
| `AI_PROVIDER` | `fake` |
| `BATON_ALLOW_FAKE_AI` | `1` |

Generate the secrets (prints four lines to paste into `.env.local`):

```bash
node -e "const c=require('crypto');const p=c.randomBytes(32).toString('hex');console.log('IDENTITY_PEPPER='+p);console.log('IDENTITY_PEPPER_CANARY='+c.createHmac('sha256',Buffer.from(p,'utf8')).update('baton:identity-pepper-canary:p1').digest('hex'));console.log('IDENTITY_MAP_KEY='+c.randomBytes(32).toString('hex'));console.log('CRON_SECRET='+c.randomBytes(32).toString('base64url'))"
```

The canary is `HMAC-SHA256(pepper, "baton:identity-pepper-canary:p1")` in hex (`lib/privacy/identity.ts`); parsing
refuses to run if the pepper and canary do not match.

**No AI key needed.** `AI_PROVIDER=fake` with `BATON_ALLOW_FAKE_AI=1` turns on the built-in test adapter: deterministic
keyword rules, no network, and labelled as the test adapter in each run's provenance. It only runs when `NODE_ENV` is `development` or
`test` (that is, under `npm run dev`); a production build refuses it. Its extraction is far weaker than a real model,
so expect fewer points than on the live site. To use a real model instead, see `.env.example` (Gemini or Omega Plus)
and `docs/ai/ai-extraction-and-verification.md`.

### 4. Run the app

```bash
npm run dev
```

Open http://localhost:3000. Google sign-in is not configured locally, so use **Continue with email and password →
Create an account** (the local stack does not require email confirmation). Processing runs in the background: under
`next dev` a development worker drains the job queue automatically when Supabase is local. Invitation and Gap Interview
links are copied from the app, since no email provider is configured.

### 5. Run the tests

```bash
npm test             # all node:test suites (contracts, db, parsers, ui, connectors, ai, actions, pipeline, selftest, integration)
npm run typecheck
npm run lint
npm run test:sql     # optional: SQL suites in a throwaway Postgres container (needs bash and Docker)
```

Stop the local stack with `npx supabase@2.122.1 stop`.

## Stack

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui (Base UI primitives) · Framer Motion · Lucide · Zod · React Hook Form · Sonner

```bash
npm ci
npm run dev     # http://localhost:3000
npm run lint
npm run build

# Shared-contract tests (Node's built-in runner; no extra dependency)
npm run test:contracts
```

Shared contracts (enums, Zod schemas, DTOs, parser and identity contracts, the read facade) live in
`lib/contracts/` and are specified in `docs/architecture/shared-contracts.md`. The latest
reconciliation with the feature branches is in `docs/architecture/contract-reconciliation.md`.

All documentation is indexed in [`docs/README.md`](docs/README.md) (judges: start with `docs/submission/SUBMISSION.md`).

## Structure

```
app/
  (marketing)/        /                       public site (SiteHeader + SiteFooter)
  (auth)/login        /login                  centred auth card
  (workspace)/        /dashboard, /handover/* AppShell (dark sidebar)
    handover/[id]/    processing · review · gaps · settings (shared HandoverNav)
  (token)/            /g/[token], /h/[token]  SharedLinkShell, noindex
components/
  ui/                 shadcn/ui primitives (generated; edit sparingly)
  layout/             AppShell, AppSidebar, MobileHeader, PageContainer, SiteHeader…
  shared/             BatonLogo, PageHeader, SectionHeading, StatusBadge, LoadingState,
                      EmptyState, ConfirmDialog, ProgressIndicator, FadeIn
  dashboard/ handover/ review/   feature components, one folder per feature
config/               site metadata, navigation, evidence-status metadata
lib/                  contracts (shared types and schemas), fonts, routes (path helpers), utils (cn)
types/                shared domain types (EvidenceStatus)
hooks/                shared client hooks
```

## Conventions

- **Design tokens** live in `app/globals.css` (`:root` + `@theme`). Use token classes
  (`bg-card`, `border-border`, `text-status-missing-fg`, `shadow-soft`), never raw hex.
  Dark mode = add a `.dark {}` block redefining the same variables.
- **Evidence statuses** (`sourced`, `inferred`, `conflicting`, `missing`) are defined in
  `types/status.ts`; labels and classes in `config/status.ts`.
  Use the `-fg` colour for text — the base colours are for marks and dots.
- **Fonts:** `font-serif` (Instrument Serif) for page titles, `font-sans` (Inter) for UI,
  `font-mono` (JetBrains Mono) for source quotes and evidence.
- **Routes:** build paths with `routes` from `lib/routes.ts`.
- Server components by default; add `"use client"` only for interactivity.
- Import components directly from their files (no barrel files).

## Next.js 16.4: Cache Components and Suspense

Cache Components (with Partial Prerendering) is **on by default**. Every route must produce
a static shell at build time, and `npm run build` **fails** if runtime data is read outside
a `<Suspense>` boundary. `npm run dev` only shows a warning in the overlay, so run
`npm run build` before you merge.

**Runtime data**: anything that is only known when the request arrives:

| Source | Where it shows up |
| --- | --- |
| `params` for dynamic segments (`[id]`, `[token]`) without `generateStaticParams` | pages, layouts, `generateMetadata` |
| `searchParams`, `cookies()`, `headers()`, `connection()` | server components |
| `usePathname()`, `useParams()`, `useSearchParams()` under a dynamic segment | client components |
| uncached `fetch`, database or AI calls | server components |
| `new Date()`, `Math.random()`, `crypto.randomUUID()` during render | anywhere |

**Rules**

1. Keep layouts and page shells synchronous. Don't `await params` at the top of a layout,
   because that turns the whole subtree dynamic.
2. Push runtime reads into small async child components and wrap them in
   `<Suspense fallback={...}>`. Give the fallback the same size as the content
   (skeleton, `LoadingState`) so the layout doesn't shift.
3. Client components that use navigation hooks render inside `<Suspense>` with a static
   fallback. Reference implementations:
   - `components/layout/workspace-navigation.tsx`: static nav list fallback, active state fills in at request time.
   - `app/(workspace)/handover/[id]/layout.tsx`: `HandoverNav` reads `useParams()` inside Suspense.
4. For data that can be shared between requests, use `"use cache"` (with `cacheLife` /
   `cacheTag`) rather than leaving it uncached.
5. `export const instant = false` opts a route out of the static shell (blocking render).
   It's a last resort; note why in a comment if you use it.
6. Type pages and layouts with the global helpers `PageProps<"/handover/[id]">` and
   `LayoutProps<"/handover/[id]">`. They're generated by `next dev`, `next build` or
   `npx next typegen`. If `tsc` reports stale route types, delete `.next/` and rebuild.

Pattern for a page that needs the handover id:

```tsx
import { Suspense } from "react";

export default function ReviewPage({ params }: PageProps<"/handover/[id]/review">) {
  return (
    <PageContainer>
      <PageHeader title="Review" />            {/* static: part of the shell */}
      <Suspense fallback={<LoadingState />}>
        <ReviewContent params={params} />      {/* pass the promise, await inside */}
      </Suspense>
    </PageContainer>
  );
}

async function ReviewContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // fetch handover data here
}
```

The bundled docs for this exact version are in `node_modules/next/dist/docs/` (see `AGENTS.md`).
Read them before using an unfamiliar API, because they differ from older Next.js releases.

## shadcn/ui notes

- This project uses the `base-nova` style, built on **Base UI** rather than Radix. To render a
  component as another element, use the `render` prop (e.g. `<DialogTrigger render={<Button />} />`),
  not `asChild`.
- To style a `next/link` as a button, use `className={buttonVariants({ ... })}`.
- Add components with `npx shadcn@latest add <name>`. Generated files in `components/ui/` import
  `cn` from the `cn` package; app code imports it from `@/lib/utils`. Both are the same function.
- `components/ui/card.tsx` and `components/ui/sonner.tsx` have small Baton changes (warm border,
  light-only toasts). Running `shadcn add --overwrite` would undo them.

## Working in parallel (worktrees)

- Each feature lives in its own folder (`components/<feature>/`, its own routes). Edit
  `components/shared`, `components/layout`, `config/`, `app/globals.css` and `lib/` only when
  your feature really needs it, and say so in your PR, because those files affect every other branch.
- Run `npm install` in each new worktree, because `node_modules` is not shared.
- Use a different dev port per worktree: `npm run dev -- -p 3001`.
- Before merging, run `npm run lint` and `npm run build`.
