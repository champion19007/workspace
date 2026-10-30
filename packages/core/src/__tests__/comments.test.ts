import { describe, it, expect } from 'vitest';
import { MAX_THREAD_RECIPIENTS, commentRecipients } from '../comments/index.js';

describe('commentRecipients', () => {
  const base = { authorId: 'author', mentionedIds: [], earlierCommenterIds: [], assigneeId: null, creatorId: null };

  it('notifies mentions, the owner, the creator and the conversation, once each, never the author', () => {
    expect(
      commentRecipients({
        authorId: 'author',
        mentionedIds: ['asha', 'author'],
        earlierCommenterIds: ['ravi', 'asha', 'author'],
        assigneeId: 'meera',
        creatorId: 'asha',
      })
    ).toEqual(['asha', 'meera', 'ravi']);
  });

  it('has nobody to tell when the author comments alone on their own work', () => {
    expect(commentRecipients({ ...base, assigneeId: 'author', creatorId: 'author' })).toEqual([]);
  });

  it('keeps only the latest voices of a long thread', () => {
    const thread = Array.from({ length: MAX_THREAD_RECIPIENTS + 5 }, (_, i) => `person${i}`);
    const recipients = commentRecipients({ ...base, earlierCommenterIds: thread });
    expect(recipients).toHaveLength(MAX_THREAD_RECIPIENTS);
    expect(recipients[0]).toBe('person5');
  });
});
