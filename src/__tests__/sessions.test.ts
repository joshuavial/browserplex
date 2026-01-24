import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionManager } from '../sessions.js';

describe('SessionManager', () => {
  afterEach(async () => {
    await sessionManager.destroyAll();
  });

  describe('create', () => {
    it('creates a chromium session', async () => {
      const session = await sessionManager.create('test-chromium', 'chromium');

      expect(session.name).toBe('test-chromium');
      expect(session.type).toBe('chromium');
      expect(session.page).toBeDefined();
      expect(session.context).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('throws when creating duplicate session name', async () => {
      await sessionManager.create('duplicate', 'chromium');

      await expect(sessionManager.create('duplicate', 'chromium'))
        .rejects.toThrow("Session 'duplicate' already exists");
    });

    it('creates sessions with different names', async () => {
      const session1 = await sessionManager.create('first', 'chromium');
      const session2 = await sessionManager.create('second', 'chromium');

      expect(session1.name).toBe('first');
      expect(session2.name).toBe('second');
      expect(sessionManager.list()).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('returns session when it exists', async () => {
      await sessionManager.create('existing', 'chromium');

      const session = sessionManager.get('existing');

      expect(session).toBeDefined();
      expect(session?.name).toBe('existing');
    });

    it('returns undefined when session does not exist', () => {
      const session = sessionManager.get('nonexistent');

      expect(session).toBeUndefined();
    });
  });

  describe('getOrThrow', () => {
    it('returns session when it exists', async () => {
      await sessionManager.create('exists', 'chromium');

      const session = sessionManager.getOrThrow('exists');

      expect(session.name).toBe('exists');
    });

    it('throws when session does not exist', () => {
      expect(() => sessionManager.getOrThrow('missing'))
        .toThrow("Session 'missing' not found. Create it first with session_create.");
    });
  });

  describe('destroy', () => {
    it('removes an existing session', async () => {
      await sessionManager.create('to-destroy', 'chromium');
      expect(sessionManager.get('to-destroy')).toBeDefined();

      await sessionManager.destroy('to-destroy');

      expect(sessionManager.get('to-destroy')).toBeUndefined();
    });

    it('throws when destroying nonexistent session', async () => {
      await expect(sessionManager.destroy('nonexistent'))
        .rejects.toThrow("Session 'nonexistent' not found");
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions', () => {
      const sessions = sessionManager.list();

      expect(sessions).toEqual([]);
    });

    it('returns info for all sessions', async () => {
      await sessionManager.create('alpha', 'chromium');
      await sessionManager.create('beta', 'chromium');

      const sessions = sessionManager.list();

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.name).sort()).toEqual(['alpha', 'beta']);
      expect(sessions[0].type).toBe('chromium');
      expect(sessions[0].url).toBeDefined();
      expect(sessions[0].createdAt).toBeDefined();
    });
  });

  describe('destroyAll', () => {
    it('removes all sessions', async () => {
      await sessionManager.create('one', 'chromium');
      await sessionManager.create('two', 'chromium');
      await sessionManager.create('three', 'chromium');
      expect(sessionManager.list()).toHaveLength(3);

      await sessionManager.destroyAll();

      expect(sessionManager.list()).toHaveLength(0);
    });

    it('handles empty session list gracefully', async () => {
      await sessionManager.destroyAll();

      expect(sessionManager.list()).toEqual([]);
    });
  });
});
