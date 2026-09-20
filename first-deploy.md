# First deploy — plan

**Date** 2026-09-20 · **Scope** Get the current tool on a public URL. No AI features, no backend.

> **Decided.** Open source for trust; GitHub Pages now, Cloudflare before the launch push;
> F1/F2 (subject-aware crop, burst filtering) deferred — they are not part of this deploy.

## What ships

A static site. No backend, no accounts, no data collected beyond a count. Build
output is `dist/index.html` + `assets/`, plus `dist/collage-maker.html` (the
whole app in one file, for download).

**Deploy and launch are separate events.** Deploy first and quietly, to prove the
pipeline and get a real URL to test against. Launch — the Hacker News and Reddit
push — comes after F1/F2 land and the social preview works. Launching once is all
you get; the deploy is reversible.

---

## Decision 1 — Repo visibility

| Option | Pros | Cons |
|---|---|---|
| Stay private | Nothing to defend | No credibility benefit; the privacy claim stays unverifiable |
| **Go public** | "Nothing leaves your device" becomes checkable instead of claimed. Open source is table stakes for the audience we're launching to | Anyone can fork and rehost |

**Decided: public.** People need to trust the tool with their photos, and open
source is how that trust gets earned. Forking was accepted when we chose MIT.

Note that a private repo would not have protected the algorithm anyway: the app
ships its full logic to every browser, and minifiers leave object property names
intact, so the scoring weights are readable in the bundle either way. Standard
minification stays on for bundle size; it is not a protection measure.

## Decision 2 — Host

| Option | Pros | Cons |
|---|---|---|
| GitHub Pages | Free, no new account, already where the repo is | 100GB/mo soft cap; no path to the Phase 1 API; no analytics |
| **Cloudflare Workers (static assets)** | Only free tier with unmetered bandwidth; fastest CDN; free privacy analytics; **the Phase 1 API lives on the same platform** | One more account to set up |
| Netlify | Easy setup | 100GB cap, credit-pool system since 2025, non-commercial restriction on free tier |
| Vercel | Best DX | Hobby tier forbids commercial use — breaks the moment Phase 1 charges |

**Decided: GitHub Pages now, Cloudflare before the launch push.** Pages needs no
new account and goes live today, which is what "deploy now" requires. Cloudflare
remains the right host for launch day — unmetered bandwidth is the one that
matters if the front page happens, and Netlify and Vercel free tiers both bar
commercial use, which Phase 1 would violate. Moving is a DNS change, not a
rebuild, so nothing is lost by starting on Pages.

## Decision 3 — Domain

| Option | Cost | Pros | Cons |
|---|---|---|---|
| `*.workers.dev` subdomain | $0 | Instant, zero setup | Reads as a toy; can't move traffic later without losing links |
| Product domain, e.g. `collagemaker.app` | ~$15/yr | Clean for this one product | Every future product needs its own; brand doesn't compound |
| **Brand domain + per-product subdomain** | ~$12/yr | One domain carries every future product. `collage.<brand>.com` now, `<next>.<brand>.com` free later | Requires choosing the brand name now |

**Recommend: brand domain, product on a subdomain.** This is the decision with
the longest shadow. The stated goal is a brand that carries into later AI
products — per-product domains actively work against that, and a `workers.dev`
URL undercuts the credibility the launch is meant to buy.

**This needs your input: what's the brand name?** Everything else can proceed
without it; deploy to the free subdomain first and attach the domain later
without redeploying.

## Decision 4 — Build pipeline

| Option | Pros | Cons |
|---|---|---|
| Platform auto-deploy on push | Zero config | Ships whether or not the 89 tests pass |
| **GitHub Actions: test → build → deploy** | Nothing reaches production past a red test; reproducible; same command locally and in CI | ~30 lines of YAML |

**Recommend: Actions.** `npm run build` already runs typecheck and the full suite
before Vite, so the gate is nearly free. The tests have already caught two real
bugs; deploying around them wastes them.

## Decision 5 — Measuring the gate

The Phase 0 gate is ~1,000 **completed exports**, not pageviews. That constrains
the choice more than privacy does.

| Option | Cost | Pros | Cons |
|---|---|---|---|
| Cloudflare Web Analytics alone | $0 | No cookies, no storage access, zero work | **No custom events — cannot count exports.** Fails the gate requirement |
| Plausible | $9/mo | Custom events, privacy-first, hosted | Paid, and adds a third party to a tool whose pitch is "no third parties" |
| **CF Web Analytics + own counter** | $0 | Counter is ~20 lines on a Worker; no third party at all; **first brick of the Phase 1 backend** | You own it, so you maintain it |
| Nothing | $0 | Simplest | The gate becomes unmeasurable and Phase 1 has no trigger |

**Recommend: Cloudflare Web Analytics for pageviews, plus a one-endpoint counter
for exports.** The counter sends a bare increment — no identifier, no payload, no
IP logging beyond the edge — which is a stronger privacy story than routing
through Plausible, and it doubles as the first piece of Phase 1's substrate.

Say on the page exactly what it counts. "We count that an export happened. That's it."

## Decision 6 — Single-file distribution

| Option | Pros | Cons |
|---|---|---|
| GitHub Release asset | Versioned, standard, free | Needs a release step |
| Served from the site | One click, no GitHub account needed | Unversioned |
| **Both** | Site serves current; releases keep history | Two places to update |

**Recommend: both.** The site link is what people will actually click; releases
matter the first time someone asks for an older build.

---

## Before launch

Closed in this pass: social preview text tags, Content-Security-Policy, repo
public, docs committed.

| | Still open | Why it matters |
|---|---|---|
| 1 | No `og:image` | Links on HN, Reddit and X render without a picture. Should be a 1200×630 export of a real collage — the product is the screenshot |
| 2 | F1 and F2 not built | Deliberately out of this deploy. Launch wants them |
| 3 | No measurement | `connect-src 'none'` blocks any beacon. Deferred with the AI features |
| 4 | No brand domain | The Pages URL works; the domain is a launch-day nicety |

## Runbook

Done in this pass:

| | Step | Notes |
|---|---|---|
| 1 | Social preview tags and page description | `og:`/`twitter:` text tags added. Image still outstanding |
| 2 | Content-Security-Policy | `connect-src 'none'` verified in the browser: `fetch()` to an external host is blocked, export still works |
| 3 | GitHub Actions workflow | install → `npm run build` (typecheck, 89 tests, build) → publish. A red test blocks the deploy |
| 4 | Repo public, homepage set | |
| 5 | Pages enabled and first deploy | |

Outstanding, in order:

| | Step | Blocks |
|---|---|---|
| 6 | `og:image` — a 1200×630 export of a real collage | Launch, not deploy |
| 7 | Tag `v1.0.0`, attach `collage-maker.html` to the release | Nothing |
| 8 | Brand domain, once the name is settled | Nothing; the free URL works meanwhile |
| 9 | Move to Cloudflare | Launch day bandwidth |
| 10 | Build F1 and F2 | Launch |
| 11 | Launch: Hacker News, subreddits, Product Hunt | Everything above |

## If it goes wrong

| Situation | Response |
|---|---|
| Bad deploy | Roll back to the previous Workers version; it is a static bundle, so rollback is instant and total |
| Traffic spike | Unmetered bandwidth on Cloudflare — nothing to do |
| Someone finds a privacy hole | Take the claim off the page first, fix second. The claim is the asset |
| Launch lands flat | That is the gate doing its job. Do not build Phase 1 |

## Open questions

1. **Brand name and domain** — blocks Decision 3 only; everything else proceeds.
2. Does the export counter live in this repo, given it is the first piece of a service that will not be MIT?
3. Launch on a weekday morning US time, or ship quietly and let it find its own audience first?
