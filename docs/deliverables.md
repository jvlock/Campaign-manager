# Reusable campaign deliverables

CTAs, landing pages, and content assets are reusable campaign-scoped build
records. Communications link to CTAs and landing pages rather than copying
dependency notes. Landing pages may depend on content assets.

Readiness is derived from current linked records. A communication is dependency
`Ready` only when every linked CTA, directly linked landing page, CTA destination
landing page, landing-page content asset, and legacy blocking task is complete.
Missing historical task references are blockers rather than being silently
ignored.
This does not claim QA approval, scheduling eligibility, publishing, or sending.

The release endpoint records a workspace planning state and reports
`externalSending: false`; the application does not send through an ESP. URLs
point to external destinations. This model does not host landing pages or
implement recipient interest-capture analytics. Personalization and tracking
requirements are recorded in the landing-page brief for downstream builders.

A landing page may have no URL while it is being built. Setting it to
`Published` requires a valid HTTP(S) `publishedUrl`; older nonconforming rows
remain readable but block all dependent communications until corrected.

Quick-create UI flows use atomic endpoints that preserve existing links and
roll back creation if attachment fails:

- `POST /campaigns/:id/communications/:itemId/ctas`
- `POST /campaigns/:id/communications/:itemId/landing-pages`

Existing webinar `ctaLabel` and `ctaUrl` content is retained for compatibility.
Valid historical values are migrated into linked CTA records with their variant
provenance. New writes to those legacy fields are rejected. Webinar read/export
projects linked canonical CTA values (and an additional multi-CTA array) while
retaining the stored legacy JSON for lossless history. A published landing-page
destination needs a real `publishedUrl` before export; no URL is invented.