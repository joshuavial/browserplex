import type { Locator } from "playwright";
import { getLocatorFromRef, isRef } from "./snapshot.js";
import type { BrowserSession } from "./types.js";

/**
 * Get a Playwright locator from a ref (@e1) or CSS selector.
 * Refs are looked up in the session's refMap from the last snapshot.
 */
export function getLocator(session: BrowserSession, selector: string): Locator {
  if (isRef(selector)) {
    const locator = getLocatorFromRef(session.page, session.refMap, selector);
    if (!locator) {
      throw new Error(`Ref '${selector}' not found. Run browser_snapshot first to get current refs.`);
    }
    return locator;
  }
  return session.page.locator(selector);
}

/**
 * Convert Playwright errors to AI-friendly messages with actionable guidance.
 */
export function toAIFriendlyError(e: unknown, selector: string): string {
  const message = e instanceof Error ? e.message : String(e);

  if (message.includes('strict mode violation')) {
    return `Selector "${selector}" matched multiple elements. Use browser_snapshot to get specific refs, or use a more specific CSS selector.`;
  }
  if (message.includes('intercepts pointer events')) {
    return `Element "${selector}" is blocked by another element (likely a modal or overlay). Try dismissing any modals/cookie banners first.`;
  }
  if (message.includes('not visible') || message.includes('element is not visible')) {
    return `Element "${selector}" is not visible. Try scrolling it into view or check if it's hidden.`;
  }
  if (message.includes('Timeout')) {
    return `Timeout waiting for "${selector}". The element may not exist or may be slow to appear. Try increasing timeout or check the selector.`;
  }

  return message;
}

/**
 * Wrap a selector-based action so Playwright errors become AI-friendly Errors.
 * Mirrors the MCP server's `error(toAIFriendlyError(e, selector))` behaviour:
 * the thrown Error's message is the AI-friendly string.
 */
export async function withFriendlyError<T>(selector: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(toAIFriendlyError(e, selector));
  }
}
