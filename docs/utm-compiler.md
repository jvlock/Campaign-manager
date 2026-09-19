# Governed UTM compiler

This implementation follows the supplied Workspace specification. It is not
claimed to be a verified port of the separate Campaign Governance Foundation
compiler because that source and its parity fixtures were not available here.

## Governance contract

The exact category registry is stored in `taxonomy_categories`. Migration 0013
registers category keys but deliberately seeds no taxonomy terms or approvals.
Terms belong to a currently effective taxonomy version, must be non-deprecated
and non-superseded, and require an explicit latest approval:

```text
record_type = taxonomyTerm
status = approved
```

The legacy record type alias `taxonomy_term` is also read. IDs are unambiguous;
an ambiguous label or shortcode is rejected and callers are asked to supply the
term ID.

An approved `channel` term selects the formula and supplies source/medium via
metadata such as:

```json
{
  "formulaKey": "paid_search",
  "utmSource": "Google Ads",
  "utmMedium": "Paid Search"
}
```

Supported formula keys are `paid_search`, `paid_social`, `display`,
`newsletter_email`, `nurture_email`, `pre_event_email`, `post_event_email`, and
`events`. Missing metadata blocks generation. An approved `displayPartner`
override takes precedence over an approved `source` override, which takes
precedence over channel `utmSource`.

## Inputs and assembly

`productLine`, `campaignShortcode`, and `subcampaign` are required by every
formula and must form the hierarchy product line → campaign shortcode →
subcampaign. Each formula also requires every governed field it uses. Region is
optional for Paid Search, Paid Social, and Display suffixes, but is required for
Events. Paid Social and Display require exactly one of `imageSize` or
`videoLength`.

Governed shortcodes are lowercased and whitespace becomes hyphens. Free-text
keyword, automation name, event name, creative description, and event CTA are
kept raw. Dates use `YYYY-MM-DD`. `J` removes falsey/empty segments before
joining with underscores, so it never creates empty slots or `undefined`.

A supplied Salesforce Campaign ID is passthrough-only. It must be a 15- or
18-character alphanumeric ID beginning with `701`; no ID is generated.

With no destination URL, a successful request returns the generated parameter
map, null link identifiers, and `Destination URL is required to build the full
link.` Nothing is persisted. With an HTTP(S) destination, compiler-owned UTM
parameters are removed and replaced while unrelated query parameters and the
fragment are preserved.

Errors use `{ "error": { "field", "code", "message" } }`: governance failures
are HTTP 422, malformed input is HTTP 400, and a missing campaign is HTTP 404.