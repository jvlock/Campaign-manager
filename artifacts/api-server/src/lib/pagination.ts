import type { Response } from "express";

/** Stable-ID ordered live pages. Counts are always scoped before pagination. */
export function pagination(input: { limit?: unknown; offset?: unknown } = {}) {
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error("limit must be 1–500 and offset a nonnegative integer"), { status: 400 });
  }
  return { limit, offset };
}

export function pageHeaders(res: Response, page: { limit: number; offset: number }, totals: number[], returned: number) {
  const total = totals.reduce((a, b) => a + b, 0);
  const nextOffset = totals.some(count => count > page.offset + page.limit) ? page.offset + page.limit : null;
  res.setHeader("X-Pagination", JSON.stringify({ total, returned, nextOffset, hasMore: nextOffset !== null }));
}