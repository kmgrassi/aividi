# Website And Productization Scope

## Objective

Give aividi a public front door and a pathway from open-source project to hosted
product. The MVP proves the core loop; this scope adds the marketing surface
that explains the product, lets a visitor start a video from a single prompt,
presents hosted pricing, and points self-hosters to GitHub. It connects the
landing experience to the productization phases already defined in
[`../productionization-scope.md`](../productionization-scope.md).

## What Ships First (in this repo today)

- A marketing landing page at `/` that explains what aividi is, how the loop
  works, what it does, hosted pricing, and a link to the GitHub repo for
  self-hosting.
- A **one-shot** prompt entry point on the landing page: the visitor describes a
  30-second video (optionally starting from one of four template chips), and
  aividi generates the video with no uploads required.
- The existing editor moves to `/studio`, which reads `goal`, `length`, and
  `autostart` from the query string. With `autostart=1` it immediately runs the
  one-shot pipeline and shows the result.

The one-shot pipeline (`POST /api/oneshot`) plans beats from the prompt,
generates one visual per beat, assembles a timeline, and runs the critic — so a
visitor with no footage still gets a finished, editable cut. Image generation
uses the configured provider (OpenAI when `OPENAI_API_KEY` is set); without
provider keys it falls back to placeholder frames so the flow always completes.
Generating full video clips per beat (vs. still frames) is a later enhancement.

## Landing Page Content Model

- **Hero**: one-line value prop + the one-shot prompt form with template chips.
- **How it works**: the four-step loop — brief, plan, editable timeline,
  deterministic render — mirroring the README pipeline.
- **What it does**: bring-or-generate footage, character consistency,
  conversational revision, inspectable/safe rendering.
- **Pricing**: self-host (free) plus hosted tiers (see below).
- **Self-host CTA**: clone command + GitHub link.

## Hosted Pricing (indicative launch tiers)

Pricing is volume- and render-based because the cost drivers are model calls
(planning, critique, asset generation) and server-side rendering minutes. The
numbers below are starting proposals to validate, not final.

| Tier      | Price       | For                     | Key limits |
|-----------|-------------|-------------------------|------------|
| Self-host | Free        | Tinkerers, OSS users    | Bring your own model keys; unlimited local renders |
| Creator   | $19 / mo    | Solo short-form creators| ~30 finished videos/mo; 1080p; 1 workspace |
| Pro       | $49 / mo    | Heavy creators / freelancers | ~150 videos/mo; character consistency; 4K; agent API preview |
| Studio    | Custom      | Teams                   | Seats, workspaces, custom quotas, full agent API, SSO |

Pricing decisions to resolve before launch:

- Whether quotas are "finished videos," render minutes, or generation credits.
- How self-supplied model keys (BYO-key) interact with hosted quotas.
- Free hosted trial allowance vs. self-host-only free tier.
- Overage behavior: hard cap vs. metered overage.

## Two-Track Productization

aividi monetizes the same product two ways; both must stay in sync with the
durable principle that AI plans and patches structured timelines while aividi
validates, versions, renders, and stores.

1. **Open source / self-host.** The repo is the free tier. A user clones it,
   supplies their own provider keys, and runs everything locally. This is the
   acquisition and trust channel; it must always be able to run end-to-end
   without the hosted backend (the local auth-bypass mode in the
   productionization scope).
2. **Hosted.** We run rendering, storage, model orchestration, and quotas so
   non-technical users never touch keys or infrastructure. This is where
   Supabase auth, workspaces, jobs, object storage, and billing live.

## Pathway From MVP To Hosted Product

This maps onto the phases in the productionization scope:

- **Phase 1 (Stabilize):** landing page + studio split (this scope), plus the
  app-shape and project-isolation work. Marketing site can ship before the
  backend split since it only needs the prompt-handoff.
- **Phase 2 (Structured context + agent API):** hosted accounts via Supabase
  auth, workspaces, project briefs, and the agent API that powers both the
  hosted UI and external automation. Pricing tiers gate quotas here.
- **Phase 3 (Durable production):** metered billing, object storage, background
  render workers, quotas/rate limits, and richer one-shot generation (full video
  clips per beat, audio, and async job + status polling so long renders don't
  block the request).

## Out Of Scope For This Pass

- Billing integration, metering, and account provisioning (Phase 2/3).
- Per-beat full video-clip generation and async job/status polling for one-shot
  (Phase 3) — v1 generates still frames synchronously.
- Auth on the marketing site; it is public and static apart from the form.
- Final pricing — the tiers here are launch proposals to validate with users.

## Definition Of Done (this pass)

- Visiting `/` shows the landing page with hero, template chips, how-it-works,
  features, pricing, and a working GitHub link.
- Entering a prompt (or picking a template) and submitting lands on `/studio`,
  which auto-runs the one-shot and shows the generated, editable cut.
- The studio also exposes the one-shot directly ("Create video from prompt")
  alongside the existing "Cut from my clips" flow.
- `npm run build` and `npm run typecheck` pass.
