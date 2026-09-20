---
name: Map round-trip compatibility
description: How canonical activity validation must coexist with historical map nodes and optimistic saves.
---

A full-map write must accept the unchanged legacy representation returned by its own read endpoint. Validate transitions against the stored row, not just the presence of a nullable field.

**Why:** Canonical activity hardening initially rejected the null type identifier returned for historical entry/outcome nodes. Because every save includes the whole map, that blocked every new canonical activity even when its own fields were valid.

**How to apply:** Permit unchanged legacy nulls only for existing legacy rows with the same type and name. Never let a canonical row, especially MCP, clear its type to bypass validation. Keep regression coverage that creates a canonical activity through governed creation, then saves a real map containing unchanged legacy nodes.

Legacy compatibility is read/unchanged-round-trip compatibility, not permission to rename historical nodes, create new legacy nodes, or provision Webinar sessions from ungoverned historical names.

**Why:** The user explicitly prohibited legacy exceptions to generated activity identities. Existing map rows must remain usable without making compatibility a second creation or naming route.

**How to apply:** Route new activities through governed creation with server-assigned identity; accept existing IDs only as references on map saves. Do not invent campaign-title governance rules to cover the separate descriptive campaign title.