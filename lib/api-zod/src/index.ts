// Orval emits both the scoped-path Zod schema and the history query type under
// this name. Explicitly prefer the runtime path validator; retain the query
// type under a distinct public alias without editing generated output.
export { GetWebinarStandardHistoryParams } from "./generated/api";
export type { GetWebinarStandardHistoryParams as WebinarStandardHistoryQueryParams } from "./generated/types";
export * from "./generated/api";
export * from "./generated/types";
