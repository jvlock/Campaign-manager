---
name: Map round-trip compatibility
description: How canonical activity validation must coexist with historical map nodes and optimistic saves.
---

A full-map write must accept the unchanged legacy representation returned by its own read endpoint. Validate transitions against the stored row, not just the presence of a nullable field.

**Why:** Canonical activity hardening initially rejected the null type identifier returned for historical entry/outcome nodes. Because every save includes the whole map, that blocked every new canonical activity even when its own fields were valid.

**How to apply:** Permit unchanged legacy nulls only for existing legacy rows with the same type. Never let a canonical row, especially MCP, clear its type to bypass validation. Keep regression coverage that reads a real map, appends a canonical activity, and saves the unchanged legacy nodes with it.