import type { FrameLocator, Locator } from "playwright";
import { getLocatorFromRef, isRef } from "./snapshot.js";
import type { BrowserSession } from "./types.js";

/**
 * Descend through one or more nested iframes via Playwright's frameLocator
 * chain. Returns a Locator scoped to the innermost frame.
 *
 * Iframes (especially cross-origin like Stripe Checkout) are NOT pierced by
 * page.locator(...) or by CSS combinators — Playwright requires an explicit
 * frameLocator() chain. Supply each iframe selector as a separate entry in
 * `frame` (outermost first) to walk nested iframes (e.g. Stripe Embedded
 * Checkout outer + Stripe Elements inner).
 */
function chainFrame(session: BrowserSession, frame: string[]): FrameLocator {
  let fl: FrameLocator = session.page.frameLocator(frame[0]);
  for (let i = 1; i < frame.length; i++) {
    fl = fl.frameLocator(frame[i]);
  }
  return fl;
}

/**
 * Get a Playwright locator from a ref (@e1) or CSS selector. When `frame`
 * is provided, the selector is resolved INSIDE the (possibly nested) iframe
 * chain. Refs work both in the main frame and inside iframes — for iframe
 * refs, the caller must pass the same `--frame` chain used by the iframe-
 * scoped snapshot that produced the ref (so getByRole resolves inside the
 * right scope).
 */
export function getLocator(
  session: BrowserSession,
  selector: string,
  frame?: string[],
): Locator {
  if (frame && frame.length > 0) {
    const fl = chainFrame(session, frame);
    if (isRef(selector)) {
      const locator = getLocatorFromRef(session.page, session.refMap, selector, fl);
      if (!locator) {
        throw new Error(
          `Ref '${selector}' not found. Run browser_snapshot --frame '${frame.join("' --frame '")}' first.`,
        );
      }
      return locator;
    }
    return fl.locator(selector);
  }
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
 * Resolve the snapshot root for an optional frame chain. Used by
 * browserSnapshot so iframe-scoped snapshots descend into the requested
 * iframe(s) rather than the main page.
 */
export function getSnapshotRoot(session: BrowserSession, frame?: string[]): Locator {
  if (frame && frame.length > 0) {
    return chainFrame(session, frame).locator(":root");
  }
  return session.page.locator(":root");
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
