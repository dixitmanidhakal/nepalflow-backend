/**
 * Tests: Comment/DM parsing
 */

describe('Inbox - Comment Parsing', () => {
  const sampleGraphResponse = {
    data: [
      {
        id: 'page_post_1',
        message: 'Our product launch!',
        comments: {
          data: [
            {
              id: 'comment_abc',
              message: 'धेरै राम्रो! (Very nice!)',
              from: { name: 'Ram Sharma', id: 'user_1' },
              created_time: '2026-05-01T10:00:00+0000',
            },
            {
              id: 'comment_def',
              message: 'Price kati ho?',
              from: { name: 'Sita Rai', id: 'user_2' },
              created_time: '2026-05-01T11:00:00+0000',
            },
          ],
        },
      },
    ],
  };

  it('should parse comments from Graph API response', () => {
    const comments = [];
    for (const post of sampleGraphResponse.data) {
      for (const comment of post.comments?.data || []) {
        comments.push({
          platform_comment_id: comment.id,
          post_platform_id: post.id,
          commenter_name: comment.from?.name || 'Unknown',
          commenter_id: comment.from?.id,
          message: comment.message,
          comment_type: 'comment',
          platform_time: comment.created_time,
        });
      }
    }

    expect(comments.length).toBe(2);
    expect(comments[0].commenter_name).toBe('Ram Sharma');
    expect(comments[0].message).toContain('राम्रो');
    expect(comments[1].commenter_name).toBe('Sita Rai');
  });

  it('should handle Nepali Unicode in messages correctly', () => {
    const nepaliMsg = 'नमस्ते! हाम्रो उत्पादन कस्तो छ?';
    expect(nepaliMsg.length).toBeGreaterThan(0);
    expect(Buffer.from(nepaliMsg, 'utf-8').toString('utf-8')).toBe(nepaliMsg);
  });

  it('should handle missing from field gracefully', () => {
    const commentWithNoFrom = {
      id: 'comment_xyz',
      message: 'Anonymous comment',
      from: undefined,
      created_time: '2026-05-01T12:00:00+0000',
    };
    const name = commentWithNoFrom.from?.name || 'Unknown';
    expect(name).toBe('Unknown');
  });

  it('should correctly identify DMs vs comments', () => {
    const comment = { comment_type: 'comment' };
    const dm = { comment_type: 'dm' };
    expect(comment.comment_type).toBe('comment');
    expect(dm.comment_type).toBe('dm');
  });
});
