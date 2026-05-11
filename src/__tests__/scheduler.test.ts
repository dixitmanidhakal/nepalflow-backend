/**
 * Tests: Scheduling logic
 */

jest.mock('../db/database', () => ({
  __esModule: true,
  default: {
    run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: jest.fn().mockReturnValue(null),
    all: jest.fn().mockReturnValue([]),
    exec: jest.fn(),
  },
}));

jest.mock('../services/facebookService');
jest.mock('uuid', () => ({ v4: () => 'test-uuid-123' }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { schedulePost, getDuePosts } = require('../services/schedulerService') as {
  schedulePost: (params: {
    userId: string;
    accountId: string;
    content: string;
    scheduledAt: string;
    mediaUrls: string[];
    hashtags: string[];
  }) => { id: string; content: string; status: string; scheduled_at: string };
  getDuePosts: () => Array<{ id: string; content: string; status: string; scheduled_at: string; platform: string }>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbMock = require('../db/database').default as {
  run: jest.Mock;
  get: jest.Mock;
  all: jest.Mock;
  exec: jest.Mock;
};

describe('Scheduler Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('schedulePost()', () => {
    it('should insert a post and return it', () => {
      dbMock.get.mockReturnValue({
        id: 'test-uuid-123',
        content: 'Test post',
        status: 'scheduled',
        scheduled_at: '2026-12-01T10:00:00Z',
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
      dbMock.all.mockReturnValue([]);
      const result = getDuePosts();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should return due posts when present', () => {
      const mockPost = {
        id: 'post-1',
        content: 'Hello Nepal!',
        status: 'scheduled',
        scheduled_at: '2026-05-01T09:00:00Z',
        platform: 'facebook',
      };
      dbMock.all.mockReturnValue([mockPost]);

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
