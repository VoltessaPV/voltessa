# Internationalization (i18n)

The reference document for Voltessa's internationalization architecture, established in the Full
Internationalization milestone. Read this before adding, changing, or translating any customer-
facing text. `docs/PRODUCTION_VALIDATION_CHECKLIST.md` covers the deployment workflow; this
document covers the i18n system itself.

## Scope

Long-term supported languages: English, Bulgarian, German, Italian, Polish, Romanian, Greek,
Macedonian. **Phase 1** (this milestone) ships English + Bulgarian; the remaining six are added
later purely by creating their `messages/<code>/*.json` files against the key structure below — no
application code changes.

**Platform Admin (`app/admin/*`) is explicitly excluded and stays English-only.** It has its own
root layout (`app/admin/layout.tsx`), physically outside the `app/[locale]/` tree — there is no
`/en/admin/...` or `/bg/admin/...`, only `/admin/...`, unconditionally. `app/dev/*` (internal
diagnostic consoles) is excluded the same way, for the same underlying reason (not customer-facing),
via its own `app/dev/layout.tsx`.

## Production rollout status

**The internationalization infrastructure is complete and every customer-facing surface has been
migrated to it (English + Bulgarian both fully translated — see the rest of this document). Bulgarian
is nonetheless intentionally disabled in production right now**, pending a full manual QA pass across
every translated screen. This is a deliberate rollout decision, not a gap in the work: nothing was
reverted, deleted, or left half-migrated to get here.

Concretely, while Bulgarian is disabled:

- English is the only publicly reachable locale. `/en/...` is the only prefix `routing.locales`
  (see below) actually contains, so it's the only one next-intl's middleware, `generateStaticParams`,
  and the sitemap/`hreflang` output ever produce.
- The language switcher (`components/i18n/LanguageSwitcher.tsx`) renders nothing anywhere it's
  mounted — it hides itself once there's only one locale to switch between, rather than each of its
  ~10 call sites needing its own conditional.
- Visiting a Bulgarian URL directly (`/bg/...`) 308-redirects permanently to its exact English
  equivalent (`proxy.ts`), rather than 404ing or serving a partially-translated page.
- A user who already has `User.locale = "bg"` or a `voltessa-locale` cookie of `"bg"` (set before
  this rollout decision) is served English and nothing about their stored preference is touched —
  see `lib/i18n/locale-sync.ts`'s and `lib/email/locale.ts`'s own doc comments for exactly how
  that distinction (`LOCALES`, the full known set, vs. `routing.locales`, the enabled subset) is kept.
- `messages/bg/*.json` is untouched, still complete, and still validated by `i18n:validate`/
  `i18n:check-terminology` in CI exactly as before — nothing about the translation content or
  tooling depends on whether Bulgarian is enabled.

**Re-enabling Bulgarian is a one-line change**: add `"bg"` back to `lib/i18n/routing.ts`'s
`ENABLED_LOCALES` array. Every piece of behavior above is derived from that one array (directly, or
via `routing.locales`, which next-intl builds from it) — not from a scattered set of feature flags —
so there is no second migration project to do later, no code to un-revert, and no translations to
re-write. The moment that line changes, `/bg/...` routes become reachable again, the switcher
reappears everywhere, static generation/sitemaps include Bulgarian again, and any user whose stored
preference was already `"bg"` sees Bulgarian again immediately, with no re-selection needed.

## Architecture summary

- **Framework**: [next-intl](https://next-intl.dev) — chosen for first-class Next.js App Router/RSC
  support, an official routing/middleware integration, typed message keys, and built-in
  `Intl`-backed formatting. See the approved architecture proposal for the full evaluation against
  next-i18next/i18next/alternatives.
- **Routing**: explicit locale prefixes for every *enabled* locale, including English (`/en/...`)
  — `lib/i18n/routing.ts`'s `localePrefix: "always"`. No hidden default locale. Route *slugs* never
  change per locale (`/dashboard`, `/settings`, `/market`, ... are identical across every language)
  — only UI text is translated. `proxy.ts` composes next-intl's middleware with the existing
  NextAuth logic; `/admin` and `/dev` are excluded from its matcher entirely. `routing.locales` is
  driven by `ENABLED_LOCALES`, a deliberately separate, smaller array than the full `LOCALES` this
  codebase has translations for — see "Production rollout status" above; `/bg/...` is real,
  complete, and currently disabled, not unbuilt.
- **User language resolution order**: `User.locale` → the `voltessa-locale` cookie →
  `Accept-Language` → English. `User.locale` is only ever read/written from Node.js Server Actions
  (sign-in, explicit language switch — see `lib/i18n/locale-sync.ts` and `lib/i18n/actions.ts`),
  never from `proxy.ts`'s Edge middleware, which only reads the cookie. See those files' own doc
  comments for why.
- **Language switcher**: `components/i18n/LanguageSwitcher.tsx`, mounted wherever a customer-facing
  page needs it. Uses `next-intl`'s `router.replace(pathname, { locale })` — switching language keeps
  you on the same page, never redirects to home.
- **Formatting**: `lib/i18n/formatters.ts` — named presets for dates/numbers/currency/percent,
  wired into next-intl's `formats` config (`i18n/request.ts`, `RootProviders`). Locale governs
  *formatting convention* only; it never decides which timezone or currency is being shown — those
  stay data-driven (`Plant.timezone`, `AutomationSettings.currency`).
- **SEO**: `lib/i18n/seo.ts` builds `hreflang` alternates + a self-canonical per locale/path;
  `app/[locale]/layout.tsx` and the four legal pages' `generateMetadata` use it; `app/sitemap.ts`
  emits one entry per (locale × public path); `app/robots.ts` disallows `/admin` and `/dev`.
- **Backend stays language-independent**: the database never stores translated values. Enums and
  machine-readable fields (`AutomationEvent.type`, `Plant.vendor`, `AutomationSettings.currency`,
  ...) remain canonical; anything human-readable is rendered from structured data through i18n at
  the presentation layer, never pre-rendered into a column. (This milestone specifically fixed one
  real violation: `AutomationEvent.summary`/`.reason` used to store pre-rendered English prose — see
  `lib/automation/market-price-optimization-scheduler.ts` and
  `lib/notifications/automation-notifications.ts`.)

## Namespace structure

One JSON file per namespace, per locale, under `messages/<locale>/`:

| Namespace | Covers |
|---|---|
| `terminology` | Canonical nouns only (see below) |
| `shared` | Generic UI (buttons, footer) |
| `navigation` | Sidebar/header nav labels |
| `marketing` | Landing page + page metadata |
| `auth` | Login, create-account, forgot/reset password, verify-email |
| `onboarding` | Onboarding flow |
| `dashboard` | Dashboard |
| `settings` | Settings |
| `market` | Market page |
| `clients` | Trader workspace |
| `alerts` | Alerts |
| `automations` | Automations |
| `battery` | BESS pages |
| `legal` | Privacy/Terms/Cookie Policy/Company |
| `cookie-consent` | Consent banner/modal |
| `emails` | Transactional email copy |
| `validation` | Validation error messages, keyed by stable code |
| `errors` | System/API/error-page messages |
| `charts` | Titles/legends/tooltips/axis labels/empty/loading states |
| `tables` | Shared table chrome |
| `forms` | Shared field labels/placeholders |
| `dialogs` | Confirm dialogs/modals |
| `notifications` | Toasts + push-notification copy |

`messages/<locale>/index.ts` imports and merges every namespace into one object — that's what
`i18n/request.ts` loads per request, and what `global.d.ts` types every `t()` call against
(English's shape is the type contract).

## Terminology system

`terminology.json` is the **single canonical source** for every recurring domain noun — Trader,
Client, Organization, Portfolio, Market, Supplier, DSO, Automation, Alert, Forecast, Battery, Plant,
Dashboard, Settings, Export Mode, Zero Export, No Limit, Threshold. Every other namespace
**interpolates** these rather than re-translating them:

```json
// messages/en/market.json
{ "portfolioSummary": { "title": "{trader} Portfolio Overview" } }
```
```tsx
const t = useTranslations("market");
const tTerm = useTranslations("terminology");
t("portfolioSummary.title", { trader: tTerm("trader") });
```

Never write `"title": "Trader Portfolio Overview"` with "Trader" re-authored inline in a second
file — `pnpm --filter web run i18n:check-terminology` (wired into CI) flags exactly that: any
namespace value that's an exact match for a canonical term's translation.

## Key naming convention

Every key is a semantic path of **at least two segments**, describing where and what — never a bare
generic terminal (`title`/`label`/`message` alone, with no scoping segment above it).

- ✅ `dashboard.energyToday.title`
- ✅ `alerts.emptyState.description`
- ✅ `market.priceTable.exportColumn`
- ❌ `title` (no context)
- ❌ `message` (no context)

JSON nests to match the path (`{ "energyToday": { "title": "..." } }`); consume via
`useTranslations("dashboard.energyToday")` → `t("title")`, or the full path from an unscoped call —
either is fine as long as the JSON hierarchy itself carries the semantic scoping.

## Technical abbreviations — never translated

API, CSV, DSO, kWh, MW, MWh, CO₂ (and any other standard technical unit/abbreviation) stay exactly
as written in every locale — including in `terminology.json` (e.g. `"dso": "DSO"` in both `en` and
`bg`). Only the surrounding prose is translated.

## How to add a new key

1. Add it to the correct `messages/en/<namespace>.json` (English is the source language — every
   translation originates from it, never the reverse).
2. Add the same key, translated, to `messages/bg/<namespace>.json` (and every other active locale).
3. Run `pnpm --filter web run i18n:validate` locally before committing — this is the same check CI
   runs, and it fails the build on a missing key exactly like a lint error would. There is no
   runtime fallback to English for a missing key; a missing translation is a build failure, not a
   silent gap.
4. If the string is a recurring domain noun already in `terminology.json`, interpolate it — don't
   re-author it.

## How to rename a key

Add the new key (steps above), update every call site to the new key, remove the old key from
*every* locale's namespace file in the same change — `i18n:validate`'s "extra key" check fails if a
locale still has a key English no longer defines, so a rename must land atomically across all
locales, not incrementally.

## How to deprecate a key

If a key needs to keep existing temporarily (e.g. mid-migration), prefix a code comment at its call
site with `// TODO(i18n): remove <key> after <reason/date>` and track it — there's no automatic
"deprecated" marker in the JSON structure itself, since JSON doesn't support comments. Remove it and
its translations together once nothing references it (`pnpm --filter web run i18n:check-unused` can
help find that point, though see its own caveat about false positives below).

## Tooling

Run from `apps/web/`:

| Command | What it does | In CI? |
|---|---|---|
| `pnpm run i18n:validate` | Missing keys, extra keys, ICU placeholder consistency, per locale vs. English | Yes — blocking |
| `pnpm run i18n:check-terminology` | Flags a namespace re-authoring a canonical term instead of interpolating it | Yes — blocking |
| `pnpm run i18n:check-missing` | Focused missing-key report only (a readable subset of `validate`) | No — dev tool |
| `pnpm run i18n:check-unused` | Best-effort "possibly unused key" report | No — heuristic, has false positives (see the script's own doc comment); review before deleting anything it flags |

## Writing translations: Translation Guidelines

**Terminology.** Use `terminology.json` for every recurring domain noun — never invent a second
translation for a term that already has a canonical one. If a genuinely new recurring term appears
in the product, add it to `terminology.json` first, in every active locale, before using it
elsewhere.

**Tone of voice.** Direct, plain, professional — matching the existing English copy's register (see
the Cookie Consent and Legal pages for the calibrated example). Not overly formal/legalistic outside
the actual legal pages, not casual/jokey anywhere. Address the user as "you" (Bulgarian: „Вие“,
formal/polite form — this is a B2B product, and the formal register matches the existing legal-page
translations already shipped).

**Capitalization.** English: sentence case for body copy and buttons ("Accept All" is an established
exception — matches existing shipped UI, treat as a fixed proper label, not a pattern to imitate
elsewhere); Title Case only for the canonical terminology nouns themselves and page titles.
Bulgarian: sentence case throughout — Bulgarian does not use English-style Title Case for buttons/
headings; don't capitalize every word of a translated button label just because the English source
does.

**Punctuation.** Preserve the English source's terminal punctuation pattern per string (a label with
no period stays a label with no period once translated; a full sentence keeps its period). Use the
locale-correct quotation marks: English `"..."`, Bulgarian „...“ (low-high guillemets) — see the
legal pages for the established pattern.

**Placeholders.** Every ICU `{placeholder}` in the English source must appear in the translation,
unchanged (the variable name itself is never translated, only the surrounding text) —
`i18n:validate` enforces this in CI. Don't reorder placeholders relative to how you'd naturally say
the sentence in the target language by changing the variable name; if the target language needs a
different word order, restructure the sentence around the same placeholder names instead.

**Abbreviations.** API, CSV, DSO, kWh, MW, MWh, CO₂, and other standard technical abbreviations are
never translated or transliterated (see above) — copy them verbatim into every locale's translation.

**Units.** Units of measurement (kW, kWh, °C, %) are not translated; only the number preceding them
is locale-formatted (`lib/i18n/formatters.ts`). Don't hand-format a number with a unit as a single
translated string (e.g. don't write `"15,5 kWh"` as a literal translated value) — pass the raw
number through the formatter and compose the unit separately, so the number itself respects the
target locale's decimal convention.

**Writing conventions.**
- Write for the actual product, never generic template text — every legal/compliance string in this
  app was written against Voltessa's real architecture, not boilerplate; hold new copy to the same
  standard.
- Keep a translated string's length in mind for UI fit, but never truncate meaning to save space —
  prefer a slightly longer, complete translation over an ambiguous short one.
- When in doubt about a term's correct translation, check `terminology.json` first, then the
  existing Privacy Policy/Terms/Cookie Policy translations (the most heavily reviewed content in the
  app) for precedent, before inventing a new rendering.
