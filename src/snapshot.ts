/**
 * Enhanced snapshot with element refs for deterministic element selection.
 *
 * Derived from agent-browser by Vercel Inc. (Apache 2.0)
 * https://github.com/anthropics/agent-browser
 *
 * This module generates accessibility snapshots with embedded refs that can be
 * used to click/fill/interact with elements without re-querying the DOM.
 *
 * Example output:
 *   - heading "Example Domain" [ref=e1] [level=1]
 *   - paragraph: Some text content
 *   - button "Submit" [ref=e2]
 *   - textbox "Email" [ref=e3]
 *
 * Usage:
 *   browser_snapshot session=main                    # Full snapshot
 *   browser_snapshot session=main interactive=true  # Interactive elements only
 *   browser_click session=main selector=@e2         # Click element by ref
 */

import type { Page, Locator } from 'playwright';
import type { RefMap } from './types.js';

export interface EnhancedSnapshot {
  tree: string;
  refs: RefMap;
}

export interface SnapshotOptions {
  /** Only include interactive elements (buttons, links, inputs, etc.) */
  interactive?: boolean;
  /** Maximum depth of tree to include (0 = root only) */
  maxDepth?: number;
  /** Remove structural elements without meaningful content */
  compact?: boolean;
  /** CSS selector to scope the snapshot */
  selector?: string;
}

// Counter for generating refs
let refCounter = 0;

/**
 * Reset ref counter (call at start of each snapshot)
 */
function resetRefs(): void {
  refCounter = 0;
}

/**
 * Generate next ref ID
 */
function nextRef(): string {
  return `e${++refCounter}`;
}

/**
 * Roles that are interactive and should get refs
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

/**
 * Roles that provide structure/context (get refs for text extraction)
 */
const CONTENT_ROLES = new Set([
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'listitem',
  'article',
  'region',
  'main',
  'navigation',
]);

/**
 * Roles that are purely structural (can be filtered in compact mode)
 */
const STRUCTURAL_ROLES = new Set([
  'generic',
  'group',
  'list',
  'table',
  'row',
  'rowgroup',
  'grid',
  'treegrid',
  'menu',
  'menubar',
  'toolbar',
  'tablist',
  'tree',
  'directory',
  'document',
  'application',
  'presentation',
  'none',
]);

/**
 * Track role+name combinations to detect duplicates
 */
interface RoleNameTracker {
  counts: Map<string, number>;
  refsByKey: Map<string, string[]>;
  getKey(role: string, name?: string): string;
  getNextIndex(role: string, name?: string): number;
  trackRef(role: string, name: string | undefined, ref: string): void;
  getDuplicateKeys(): Set<string>;
}

function createRoleNameTracker(): RoleNameTracker {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();
  return {
    counts,
    refsByKey,
    getKey(role: string, name?: string): string {
      return `${role}:${name ?? ''}`;
    },
    getNextIndex(role: string, name?: string): number {
      const key = this.getKey(role, name);
      const current = counts.get(key) ?? 0;
      counts.set(key, current + 1);
      return current;
    },
    trackRef(role: string, name: string | undefined, ref: string): void {
      const key = this.getKey(role, name);
      const refs = refsByKey.get(key) ?? [];
      refs.push(ref);
      refsByKey.set(key, refs);
    },
    getDuplicateKeys(): Set<string> {
      const duplicates = new Set<string>();
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          duplicates.add(key);
        }
      }
      return duplicates;
    },
  };
}

/**
 * Get enhanced snapshot with refs and optional filtering
 */
export async function getEnhancedSnapshot(
  page: Page,
  options: SnapshotOptions = {}
): Promise<EnhancedSnapshot> {
  resetRefs();
  const refs: RefMap = {};

  // Get ARIA snapshot from Playwright
  const locator = options.selector ? page.locator(options.selector) : page.locator(':root');
  const ariaTree = await locator.ariaSnapshot();

  if (!ariaTree) {
    return {
      tree: '(empty)',
      refs: {},
    };
  }

  // Parse and enhance the ARIA tree
  const enhancedTree = processAriaTree(ariaTree, refs, options);

  return { tree: enhancedTree, refs };
}

/**
 * Process ARIA snapshot: add refs and apply filters
 */
function processAriaTree(ariaTree: string, refs: RefMap, options: SnapshotOptions): string {
  const lines = ariaTree.split('\n');
  const result: string[] = [];
  const tracker = createRoleNameTracker();

  // For interactive-only mode, we collect just interactive elements
  if (options.interactive) {
    for (const line of lines) {
      const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
      if (!match) continue;

      const [, , role, name, suffix] = match;
      const roleLower = role.toLowerCase();

      if (INTERACTIVE_ROLES.has(roleLower)) {
        const ref = nextRef();
        const nth = tracker.getNextIndex(roleLower, name);
        tracker.trackRef(roleLower, name, ref);
        refs[ref] = {
          role: roleLower,
          name,
          nth,
        };

        let enhanced = `- ${role}`;
        if (name) enhanced += ` "${name}"`;
        enhanced += ` [ref=${ref}]`;
        if (nth > 0) enhanced += ` [nth=${nth}]`;
        if (suffix && suffix.includes('[')) enhanced += suffix;

        result.push(enhanced);
      }
    }

    removeNthFromNonDuplicates(refs, tracker);
    return result.join('\n') || '(no interactive elements)';
  }

  // Normal processing with depth/compact filters
  for (const line of lines) {
    const processed = processLine(line, refs, options, tracker);
    if (processed !== null) {
      result.push(processed);
    }
  }

  removeNthFromNonDuplicates(refs, tracker);

  if (options.compact) {
    return compactTree(result.join('\n'));
  }

  return result.join('\n');
}

/**
 * Remove nth from refs that ended up not having duplicates
 */
function removeNthFromNonDuplicates(refs: RefMap, tracker: RoleNameTracker): void {
  const duplicateKeys = tracker.getDuplicateKeys();

  for (const [ref, data] of Object.entries(refs)) {
    const key = tracker.getKey(data.role, data.name);
    if (!duplicateKeys.has(key)) {
      delete refs[ref].nth;
    }
  }
}

/**
 * Get indentation level (number of spaces / 2)
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

/**
 * Process a single line: add ref if needed, filter if requested
 */
function processLine(
  line: string,
  refs: RefMap,
  options: SnapshotOptions,
  tracker: RoleNameTracker
): string | null {
  const depth = getIndentLevel(line);

  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return null;
  }

  const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);

  if (!match) {
    if (options.interactive) {
      return null;
    }
    return line;
  }

  const [, prefix, role, name, suffix] = match;
  const roleLower = role.toLowerCase();

  if (role.startsWith('/')) {
    return line;
  }

  const isInteractive = INTERACTIVE_ROLES.has(roleLower);
  const isContent = CONTENT_ROLES.has(roleLower);
  const isStructural = STRUCTURAL_ROLES.has(roleLower);

  if (options.interactive && !isInteractive) {
    return null;
  }

  if (options.compact && isStructural && !name) {
    return null;
  }

  const shouldHaveRef = isInteractive || (isContent && name);

  if (shouldHaveRef) {
    const ref = nextRef();
    const nth = tracker.getNextIndex(roleLower, name);
    tracker.trackRef(roleLower, name, ref);

    refs[ref] = {
      role: roleLower,
      name,
      nth,
    };

    let enhanced = `${prefix}${role}`;
    if (name) enhanced += ` "${name}"`;
    enhanced += ` [ref=${ref}]`;
    if (nth > 0) enhanced += ` [nth=${nth}]`;
    if (suffix) enhanced += suffix;

    return enhanced;
  }

  return line;
}

/**
 * Remove empty structural branches in compact mode
 */
function compactTree(tree: string): string {
  const lines = tree.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('[ref=')) {
      result.push(line);
      continue;
    }

    if (line.includes(':') && !line.endsWith(':')) {
      result.push(line);
      continue;
    }

    const currentIndent = getIndentLevel(line);
    let hasRelevantChildren = false;

    for (let j = i + 1; j < lines.length; j++) {
      const childIndent = getIndentLevel(lines[j]);
      if (childIndent <= currentIndent) break;
      if (lines[j].includes('[ref=')) {
        hasRelevantChildren = true;
        break;
      }
    }

    if (hasRelevantChildren) {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Parse a ref from command argument (e.g., "@e1" -> "e1")
 */
export function parseRef(arg: string): string | null {
  if (arg.startsWith('@')) {
    return arg.slice(1);
  }
  if (arg.startsWith('ref=')) {
    return arg.slice(4);
  }
  if (/^e\d+$/.test(arg)) {
    return arg;
  }
  return null;
}

/**
 * Check if a selector string is a ref
 */
export function isRef(selector: string): boolean {
  return parseRef(selector) !== null;
}

/**
 * Get a Playwright locator from a ref using the refMap
 */
export function getLocatorFromRef(page: Page, refMap: RefMap, selector: string): Locator | null {
  const ref = parseRef(selector);
  if (!ref) return null;

  const refData = refMap[ref];
  if (!refData) return null;

  let locator: Locator;
  if (refData.name) {
    locator = page.getByRole(refData.role as any, {
      name: refData.name,
      exact: true
    });
  } else {
    locator = page.getByRole(refData.role as any);
  }

  if (refData.nth !== undefined) {
    locator = locator.nth(refData.nth);
  }

  return locator;
}

/**
 * Get snapshot statistics
 */
export function getSnapshotStats(
  tree: string,
  refs: RefMap
): {
  lines: number;
  chars: number;
  tokens: number;
  refs: number;
  interactive: number;
} {
  const interactive = Object.values(refs).filter((r) => INTERACTIVE_ROLES.has(r.role)).length;

  return {
    lines: tree.split('\n').length,
    chars: tree.length,
    tokens: Math.ceil(tree.length / 4),
    refs: Object.keys(refs).length,
    interactive,
  };
}
