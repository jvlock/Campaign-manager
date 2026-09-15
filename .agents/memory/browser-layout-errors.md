---
name: Browser layout error diagnosis
description: Interpreting unknown runtime reports without an Error object in the preview.
---

An “unknown runtime error” with only an injected reporting stack does not establish a React exception. Inspect the native ErrorEvent message, even when its error property is absent.

**Why:** A recurring campaign-map report was eventually identified by native diagnostics as “ResizeObserver loop completed with undelivered notifications.” API calls succeeded and independent screenshots often loaded normally, so a clean screenshot alone did not explain the report.

**How to apply:** Preserve native diagnostic reporting. For resize feedback, defer observer-driven layout writes to an animation frame and cancel queued work on cleanup rather than globally suppressing error events. The current dependency patch covers the ESM builds consumed by this Vite app; reassess upstream behavior when upgrading React Flow.