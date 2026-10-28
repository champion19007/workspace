export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Sign-in codes and invitations go out on the transactional stream; mentions, requests and digests on the
   * notifications stream, so complaints about notifications never slow down a sign-in email.
   */
  stream: 'transactional' | 'notifications';
  /** The provider sends at most once per key, so a retried request never emails twice. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface EmailPort {
  readonly provider: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}
