# Provisional taxonomy quarantine

Migration `0016_foundation_production_taxonomy.sql` preserves the migrated
Campaign Governance Foundation sample in the current effective taxonomy version,
but the source system has an unresolved security defect and its production data
has not been validated. These values are quarantined development data:

- 7 `product_line` terms
- 51 `campaign_shortcode` terms
- 40 `subcampaign` terms

Every row carries `source_environment=development`,
`verification_status=provisional`, `publishing_eligible=false`,
`source_reference="Campaign Governance Foundation, migrated via audit"`, and
`requires_business_validation=true`. Migration
`0019_quarantine_foundation_governance.sql` applies the same quarantine to
existing rows and removes any taxonomy-term approvals. It does not delete,
replace, or mint identifiers.

`stable_key` remains immutable identity. Repeated tag codes are valid when their
parents differ, so campaign and subcampaign resolution must use the declared
parent hierarchy. The migration preserves UUIDs on replay. Registration and
source provenance are not approval; no migrated value is governance-approved or
eligible for publishing.
For stable-key import replay, omitted `sourceMetadata` preserves the stored
metadata; an explicitly supplied metadata object replaces it.

The sample is intentionally partial. The remaining 88 subcampaigns must be
added only from authenticated source rows in a future pass. Do not invent
placeholder values, infer missing hierarchy, or auto-approve newly registered
terms.