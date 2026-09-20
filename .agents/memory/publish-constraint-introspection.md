---
name: Publish constraint introspection
description: Managed publishing can misrender PostgreSQL NOT VALID CHECK constraints.
---
Avoid leaving CHECK constraints unvalidated when preparing a managed publish, where existing data can safely satisfy them.

**Why:** On 2026-09-20, publishing introspected a deferred CHECK and generated an extra closing parenthesis around its trailing NOT VALID clause. Compilation succeeded but the database promotion failed. Validating the development constraint yielded correct SQL.

**How to apply:** Inspect the actual publish diff, check for violations in both development and production with read-only queries first, then validate development through its migration flow if safe. Never delete legacy data to force validation or mutate production directly. Verify the regenerated statement rather than assuming a successful code build proves the database update is valid.