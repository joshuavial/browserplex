import * as actions from "./actions.js";
import type { ActionResult } from "./types.js";

/**
 * Tool-name → core action registry. The single source of "tool name → behaviour",
 * shared by any frontend that receives a tool name as a string (the daemon resolves
 * incoming requests against it). The MCP server does NOT use this — it wires each
 * tool explicitly with its zod schema — but the names/behaviour are identical.
 *
 * Args pass straight through; each action validates/defaults internally (as today).
 */
export type Action = (args: Record<string, unknown>) => Promise<ActionResult>;

export const actionDispatch: Record<string, Action> = {
  // session management
  session_create: (a) => actions.sessionCreate(a as never),
  session_list: () => actions.sessionList(),
  session_destroy: (a) => actions.sessionDestroy(a as never),
  // storage
  storage_save: (a) => actions.storageSave(a as never),
  storage_load: (a) => actions.storageLoad(a as never),
  storage_list: (a) => actions.storageList(a as never),
  storage_delete: (a) => actions.storageDelete(a as never),
  storage_lock: (a) => actions.storageLock(a as never),
  storage_unlock: (a) => actions.storageUnlock(a as never),
  // navigation
  browser_navigate: (a) => actions.browserNavigate(a as never),
  browser_navigate_back: (a) => actions.browserNavigateBack(a as never),
  browser_snapshot: (a) => actions.browserSnapshot(a as never),
  browser_take_screenshot: (a) => actions.browserTakeScreenshot(a as never),
  // interaction
  browser_click: (a) => actions.browserClick(a as never),
  browser_type: (a) => actions.browserType(a as never),
  browser_press_key: (a) => actions.browserPressKey(a as never),
  browser_hover: (a) => actions.browserHover(a as never),
  browser_drag: (a) => actions.browserDrag(a as never),
  browser_select_option: (a) => actions.browserSelectOption(a as never),
  browser_file_upload: (a) => actions.browserFileUpload(a as never),
  browser_fill_form: (a) => actions.browserFillForm(a as never),
  browser_handle_dialog: (a) => actions.browserHandleDialog(a as never),
  // utilities
  browser_wait_for: (a) => actions.browserWaitFor(a as never),
  browser_evaluate: (a) => actions.browserEvaluate(a as never),
  browser_resize: (a) => actions.browserResize(a as never),
  browser_console_messages: (a) => actions.browserConsoleMessages(a as never),
  browser_network_requests: (a) => actions.browserNetworkRequests(a as never),
  browser_tabs: (a) => actions.browserTabs(a as never),
};

/** All tool names known to the dispatch registry. */
export const TOOL_NAMES = Object.keys(actionDispatch);
