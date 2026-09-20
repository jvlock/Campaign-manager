# Governed channel and activity model

The canonical runtime catalog is defined once in
`artifacts/api-server/src/lib/activity-model.ts` and exposed by
`GET /api/activity-model/catalog`. It contains thirteen provisional channels and
twelve provisional activity configurations. Test-fixture prefixes are rejected by the
catalog integrity validator.

## Naming

Names are rendered by exact brace substitution. Required-field answers take
precedence over built-in `campaign`, `activityType`, and `name` values. No case
conversion, slugification, separator cleanup, truncation, or other normalization
occurs. An unknown placeholder, null value, array, or object throws
`ActivityModelError` with a named field and code. Boolean and numeric primitive
values render normally.

The raw naming input and generated display name are stored separately. MCP has
no name placeholder and therefore requires no raw activity name.

## Compatibility and publication boundary

Migration 0014 is additive. Existing generic activities retain their IDs,
names, types, tasks, communications, webinar sessions, and map links. New API
activity creation requires a canonical type. Existing legacy rows can still be
saved without being destructively remapped.

This application has no activity-configuration publication workflow. Static
configuration integrity is checked before catalog exposure. The existing
campaign transition to `Live` is the applicable publication boundary, where
persisted MCP data is recursively checked again. Governed event activities may
link a webinar setup; existing legacy Webinar behavior is unchanged.

Canonical channel terms are provisional values, not approvals. Their persisted
metadata marks them as development-sourced, publishing-ineligible, and requiring
business validation. The twelve static activity configurations share that
provisional boundary at the API layer; they are not persisted in this database.
Unavailable Campaign Governance Foundation source files were not represented as
inspected, parity-tested, or governance-approved.

Communication channels are nullable. New or changed non-null values must use a
canonical channel ID, while unchanged historical values remain readable. No
communication type or webinar provider is used as an implicit channel.

Campaign inheritance uses the eight governed keys exposed by the OpenAPI
`CampaignInheritance` schema. Campaign rename and inheritance changes rerender
canonical activity state transactionally and advance each affected activity row
version; legacy activity names remain untouched.