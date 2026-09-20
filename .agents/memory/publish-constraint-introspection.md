---
name: Publish constraint introspection
description: Managed publishing CHECK serialization and composite foreign-key dependency ordering.
---
Avoid leaving CHECK constraints unvalidated when preparing a managed publish, where existing data can safely satisfy them.

**Why:** On 2026-09-20, publishing introspected a deferred CHECK and generated an extra closing parenthesis around its trailing NOT VALID clause. Compilation succeeded but the database promotion failed. Validating the development constraint yielded correct SQL.

**How to apply:** Inspect the actual publish diff, check for violations in both development and production with read-only queries first, then validate development through its migration flow if safe. Never delete legacy data to force validation or mutate production directly. Verify the regenerated statement rather than assuming a successful code build proves the database update is valid.

Composite foreign-key targets must be discoverable as UNIQUE constraints, and those constraints must precede dependent foreign keys in the generated publish SQL.

**Why:** On 2026-09-20 the managed diff omitted standalone composite unique indexes. Attaching them as UNIQUE constraints made them appear, but the diff still ordered new foreign keys before the required constraints on existing tables. A temporary-table transaction reproduced the failure; the same statements succeeded when dependencies were ordered first.

**How to apply:** Verify both presence and order of reference keys before promising publishing is fixed. A successful individual statement is insufficient. Do not bypass managed production migrations or weaken cross-campaign isolation to work around dependency ordering; escalate the generated migration ordering issue or obtain explicit consent for a separately planned staged rollout.

The user authorized a two-stage rollout: defer only the four composite landing-page/asset foreign keys, then restore them only after verifying the parent unique constraints exist in production and receiving the follow-up request.

**Why:** The managed diff cannot order these existing-table constraints correctly in one publish. The user also explicitly chose to preserve legacy asset `Confirmed` values as valid rather than rewriting production data.

**How to apply:** Keep all other constraints and quarantine protections intact. Never treat preparing stage one as proof of a successful publish. Check production directly before restoring the deferred relationships.