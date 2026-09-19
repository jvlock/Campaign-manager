# Verified taxonomy seed

Migration `0016_foundation_production_taxonomy.sql` registers the user-supplied
Campaign Governance Foundation production sample in the current effective
taxonomy version:

- 7 `product_line` terms
- 51 `campaign_shortcode` terms
- 40 `subcampaign` terms

`stable_key` is immutable identity. Repeated tag codes are valid when their
parents differ, so campaign and subcampaign resolution must use the declared
parent hierarchy. The migration preserves UUIDs on replay and invalidates prior
term approvals only when it corrects semantic term data. Registration and
source provenance are not approval; the migration creates no approval rows.
For stable-key import replay, omitted `sourceMetadata` preserves the stored
metadata; an explicitly supplied metadata object replaces it.

The sample is intentionally partial. The remaining 88 subcampaigns must be
added only from authenticated source rows in a future pass. Do not invent
placeholder values, infer missing hierarchy, or auto-approve newly registered
terms.