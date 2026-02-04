import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserContext } from 'playwright';
import type { StoredSession, LockInfo } from './types.js';

const SESSIONS_DIR = path.join(os.homedir(), '.browserplex', 'sessions');
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Sanitize names to prevent path traversal attacks
function sanitizeName(name: string): string {
  // Remove path separators and parent directory references
  return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
}

class StorageManager {
  /**
   * Ensure the sessions directory structure exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  }

  /**
   * Get the path for a stored session file
   */
  private getSessionPath(domain: string, name: string): string {
    return path.join(SESSIONS_DIR, sanitizeName(domain), `${sanitizeName(name)}.json`);
  }

  /**
   * Get the path for a domain lock file
   */
  private getLockPath(domain: string): string {
    return path.join(SESSIONS_DIR, sanitizeName(domain), '.lock');
  }

  /**
   * Save the current browser context's storage state to a named file
   */
  async save(context: BrowserContext, domain: string, name: string): Promise<string> {
    const sessionPath = this.getSessionPath(domain, name);
    await this.ensureDir(path.dirname(sessionPath));

    // Get storage state from context
    const storageState = await context.storageState();

    // Write with restrictive permissions (user-only read/write)
    await fs.writeFile(sessionPath, JSON.stringify(storageState, null, 2), {
      mode: 0o600,
    });

    return sessionPath;
  }

  /**
   * Load a stored session into a browser context
   * Returns the storage state object to be used when creating a new context
   */
  async load(domain: string, name: string): Promise<object> {
    const sessionPath = this.getSessionPath(domain, name);

    try {
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Session '${name}' not found for domain '${domain}'`);
      }
      throw err;
    }
  }

  /**
   * Check if a stored session exists
   */
  async exists(domain: string, name: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(domain, name);
    try {
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all stored sessions, optionally filtered by domain
   */
  async list(domain?: string): Promise<StoredSession[]> {
    const sessions: StoredSession[] = [];

    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      // Sessions directory doesn't exist yet
      return sessions;
    }

    const domains = domain ? [sanitizeName(domain)] : await fs.readdir(SESSIONS_DIR);

    for (const d of domains) {
      const domainPath = path.join(SESSIONS_DIR, sanitizeName(d));

      try {
        const stat = await fs.stat(domainPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(domainPath);
        for (const file of files) {
          if (!file.endsWith('.json') || file.startsWith('.')) continue;

          const filePath = path.join(domainPath, file);
          const fileStat = await fs.stat(filePath);
          const sessionName = file.replace(/\.json$/, '');

          sessions.push({
            domain: d,
            name: sessionName,
            path: filePath,
            modifiedAt: fileStat.mtime.toISOString(),
          });
        }
      } catch {
        // Skip domains we can't read
        continue;
      }
    }

    return sessions;
  }

  /**
   * Delete a stored session
   */
  async delete(domain: string, name: string): Promise<void> {
    const sessionPath = this.getSessionPath(domain, name);

    try {
      await fs.unlink(sessionPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Session '${name}' not found for domain '${domain}'`);
      }
      throw err;
    }

    // Try to clean up empty domain directory
    const domainPath = path.dirname(sessionPath);
    try {
      const remaining = await fs.readdir(domainPath);
      const nonLockFiles = remaining.filter(f => !f.startsWith('.'));
      if (nonLockFiles.length === 0) {
        // Remove lock file if present, then directory
        try {
          await fs.unlink(path.join(domainPath, '.lock'));
        } catch { /* ignore */ }
        await fs.rmdir(domainPath);
      }
    } catch { /* ignore cleanup errors */ }
  }

  /**
   * Acquire a lock for a domain (used during auth flows)
   */
  async acquireLock(domain: string): Promise<boolean> {
    const lockPath = this.getLockPath(domain);
    await this.ensureDir(path.dirname(lockPath));

    // Check for stale lock
    try {
      const lockData = await fs.readFile(lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(lockData);

      if (Date.now() - lockInfo.acquiredAt > LOCK_TIMEOUT_MS) {
        // Lock is stale, remove it
        await fs.unlink(lockPath);
      } else {
        // Lock is held by someone else
        return false;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // No lock file exists, we can proceed
    }

    // Try to acquire lock atomically
    const lockInfo: LockInfo = {
      domain,
      acquiredAt: Date.now(),
      pid: process.pid,
    };

    try {
      await fs.writeFile(lockPath, JSON.stringify(lockInfo), {
        flag: 'wx', // Fail if file exists
        mode: 0o600,
      });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Someone else grabbed the lock between our check and write
        return false;
      }
      throw err;
    }
  }

  /**
   * Release a lock for a domain
   */
  async releaseLock(domain: string): Promise<void> {
    const lockPath = this.getLockPath(domain);

    try {
      // Only release if we own it (same PID)
      const lockData = await fs.readFile(lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(lockData);

      if (lockInfo.pid === process.pid) {
        await fs.unlink(lockPath);
      }
    } catch {
      // Lock doesn't exist or can't read it, that's fine
    }
  }

  /**
   * Check if a domain is currently locked
   */
  async isLocked(domain: string): Promise<boolean> {
    const lockPath = this.getLockPath(domain);

    try {
      const lockData = await fs.readFile(lockPath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(lockData);

      // Check if lock is stale
      if (Date.now() - lockInfo.acquiredAt > LOCK_TIMEOUT_MS) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}

export const storageManager = new StorageManager();
