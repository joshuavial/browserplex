import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { storageManager } from '../storage.js';
import { sessionManager } from '../sessions.js';

const SESSIONS_DIR = path.join(os.homedir(), '.browserplex', 'sessions');
const TEST_DOMAIN = 'test.example.com';
const TEST_SESSION = 'test-session';

describe('StorageManager', () => {
  // Clean up test files after each test
  afterEach(async () => {
    await sessionManager.destroyAll();

    // Clean up test domain directory
    const testDomainPath = path.join(SESSIONS_DIR, TEST_DOMAIN);
    try {
      const files = await fs.readdir(testDomainPath);
      for (const file of files) {
        await fs.unlink(path.join(testDomainPath, file));
      }
      await fs.rmdir(testDomainPath);
    } catch {
      // Directory may not exist
    }
  });

  describe('save and load', () => {
    it('saves and loads storage state', async () => {
      // Create a session with some state
      const session = await sessionManager.create('test', 'chromium');

      // Navigate to set some state (cookies get set on navigation)
      await session.page.goto('data:text/html,<html><body>test</body></html>');

      // Save the session
      const savedPath = await storageManager.save(session.context, TEST_DOMAIN, TEST_SESSION);

      expect(savedPath).toContain(TEST_DOMAIN);
      expect(savedPath).toContain(`${TEST_SESSION}.json`);

      // Verify file exists
      const stats = await fs.stat(savedPath);
      expect(stats.isFile()).toBe(true);

      // Verify file permissions (on Unix)
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o777).toBe(0o600);
      }

      // Load it back
      const loadedState = await storageManager.load(TEST_DOMAIN, TEST_SESSION);
      expect(loadedState).toBeDefined();
      expect(typeof loadedState).toBe('object');
    });

    it('throws when loading nonexistent session', async () => {
      await expect(storageManager.load(TEST_DOMAIN, 'nonexistent'))
        .rejects.toThrow("Session 'nonexistent' not found for domain 'test.example.com'");
    });
  });

  describe('exists', () => {
    it('returns false for nonexistent session', async () => {
      const exists = await storageManager.exists(TEST_DOMAIN, 'nonexistent');
      expect(exists).toBe(false);
    });

    it('returns true for existing session', async () => {
      const session = await sessionManager.create('test', 'chromium');
      await storageManager.save(session.context, TEST_DOMAIN, TEST_SESSION);

      const exists = await storageManager.exists(TEST_DOMAIN, TEST_SESSION);
      expect(exists).toBe(true);
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions', async () => {
      const sessions = await storageManager.list('nonexistent-domain.com');
      expect(sessions).toEqual([]);
    });

    it('lists sessions for a domain', async () => {
      const session = await sessionManager.create('test', 'chromium');
      await storageManager.save(session.context, TEST_DOMAIN, 'session1');
      await storageManager.save(session.context, TEST_DOMAIN, 'session2');

      const sessions = await storageManager.list(TEST_DOMAIN);

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.name).sort()).toEqual(['session1', 'session2']);
      expect(sessions[0].domain).toBe(TEST_DOMAIN);
      expect(sessions[0].modifiedAt).toBeDefined();
    });

    it('lists sessions across all domains', async () => {
      const session = await sessionManager.create('test', 'chromium');
      await storageManager.save(session.context, TEST_DOMAIN, 'session1');
      await storageManager.save(session.context, 'other.example.com', 'session2');

      const sessions = await storageManager.list();

      expect(sessions.length).toBeGreaterThanOrEqual(2);

      // Clean up second domain
      await storageManager.delete('other.example.com', 'session2');
    });
  });

  describe('delete', () => {
    it('deletes an existing session', async () => {
      const session = await sessionManager.create('test', 'chromium');
      await storageManager.save(session.context, TEST_DOMAIN, TEST_SESSION);

      expect(await storageManager.exists(TEST_DOMAIN, TEST_SESSION)).toBe(true);

      await storageManager.delete(TEST_DOMAIN, TEST_SESSION);

      expect(await storageManager.exists(TEST_DOMAIN, TEST_SESSION)).toBe(false);
    });

    it('throws when deleting nonexistent session', async () => {
      await expect(storageManager.delete(TEST_DOMAIN, 'nonexistent'))
        .rejects.toThrow("Session 'nonexistent' not found for domain 'test.example.com'");
    });
  });

  describe('locking', () => {
    it('acquires and releases lock', async () => {
      const acquired = await storageManager.acquireLock(TEST_DOMAIN);
      expect(acquired).toBe(true);

      const isLocked = await storageManager.isLocked(TEST_DOMAIN);
      expect(isLocked).toBe(true);

      await storageManager.releaseLock(TEST_DOMAIN);

      const isStillLocked = await storageManager.isLocked(TEST_DOMAIN);
      expect(isStillLocked).toBe(false);
    });

    it('prevents double lock acquisition', async () => {
      const first = await storageManager.acquireLock(TEST_DOMAIN);
      expect(first).toBe(true);

      // Same process, same PID - should fail because lock exists
      // Note: In the actual implementation, we check PID, so same process
      // would succeed if we modified the check. Here we test the atomic write behavior.
      const second = await storageManager.acquireLock(TEST_DOMAIN);
      expect(second).toBe(false);

      await storageManager.releaseLock(TEST_DOMAIN);
    });
  });
});

describe('SessionManager with storage', () => {
  afterEach(async () => {
    await sessionManager.destroyAll();

    // Clean up test domain directory
    const testDomainPath = path.join(SESSIONS_DIR, TEST_DOMAIN);
    try {
      const files = await fs.readdir(testDomainPath);
      for (const file of files) {
        await fs.unlink(path.join(testDomainPath, file));
      }
      await fs.rmdir(testDomainPath);
    } catch {
      // Directory may not exist
    }
  });

  it('creates session with loaded storage state', async () => {
    // Create first session and save state
    const session1 = await sessionManager.create('first', 'chromium');
    await session1.page.goto('data:text/html,<html><body>test</body></html>');
    await storageManager.save(session1.context, TEST_DOMAIN, TEST_SESSION);
    await sessionManager.destroy('first');

    // Load state into new session
    const storageState = await storageManager.load(TEST_DOMAIN, TEST_SESSION);
    const session2 = await sessionManager.createWithStorage('second', 'chromium', true, storageState);

    expect(session2.name).toBe('second');
    expect(session2.context).toBeDefined();
  });
});
