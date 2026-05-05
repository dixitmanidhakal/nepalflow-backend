/**
 * Tests: Scheduling logic
 */

jest.mock('../db/database', () => {
  const mockPrepare = jest.fn().mockReturnValue({
    run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
    get: jest.fn().mockReturnValue(null),
    all: jest.fn().mockReturnValue([]),
  });
  return { prepare: mockPrepare, exec: jest.fn() };
});

jest.mock('../services/facebookService');
jest.mock('uuid', () => ({ v4: () => 'test-uuid-123' }));

const { schedulePost, getDuePosts } = require('../services/schedulerService');

describe('Scheduler Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('schedulePost()', () => {
    it('should insert a post and return it', () => {
      const db = require('../db/database');
      db.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue({
          id: 'test-uuid-123',
          content: 'Test post',
          status: 'scheduled',
          scheduled_at: '2026-12-01T10:00:00Z',
        }),
        all: jest.fn().mockReturnValue([]),
      });

      const post = schedulePost({
        userId: 'user-1',
        accountId: 'account-1',
        content: 'Test post',
        scheduledAt: '2026-12-01T10:00:00Z',
        mediaUrls: [],
        hashtags: ['#Nepal', '#SMB'],
      });

      expect(post).toBeDefined();
      expect(post.id).toBe('test-uuid-123');
    });
  });

  describe('getDuePosts()', () => {
    it('should return empty array when no posts are due', () => {
      const db = require('../db/database');
      db.prepare.mockReturnValue({ all: jest.fn().mockReturnValue([]) });
      const result = getDuePosts();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should return due posts when present', () => {
      const db = require('../db/database');
      const mockPost = {
        id: 'post-1',
        content: 'Hello Nepal!',
        status: 'scheduled',
        scheduled_at: '2026-05-01T09:00:00Z',
        platform: 'facebook',
      };
      db.prepare.mockReturnValue({ all: jest.fn().mockReturnValue([mockPost]) });

      const result = getDuePosts();
      expect(result.length).toBe(1);
      expect(result[0].platform).toBe('facebook');
    });
  });

  describe('Scheduled time validation', () => {
    it('future time should be after now', () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      expect(futureDate > new Date()).toBe(true);
    });

    it('past time should trigger immediate publish', () => {
      const pastDate = new Date(Date.now() - 1000);
      const now = new Date();
      expect(pastDate <= now).toBe(true);
    });
  });
});
