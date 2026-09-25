# campaign-workspace — frontend tests

- `pnpm --filter @workspace/campaign-workspace test` — node:test via `tsx` (devDependency, pinned `4.23.13`, same version as the workspace install), config `tsconfig.test.json`.
- `pnpm --filter @workspace/campaign-workspace typecheck`.

## Test-only dependencies
| Package | Version (exact) | Purpose |
|---|---|---|
| `tsx` | 4.23.13 | Runs TypeScript/TSX unit tests. |
| `axe-core` | 4.10.3 | Automated accessibility checks in browser test scripts. Never imported by app code, never bundled, no network/analytics. |

Browser a11y testers inject the local file:
`artifacts/campaign-workspace/node_modules/axe-core/axe.min.js`
(e.g. Playwright `page.addScriptTag({ path })`, then `await page.evaluate(() => axe.run())`).
