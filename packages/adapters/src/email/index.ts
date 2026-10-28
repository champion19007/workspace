import { AdapterUnavailableError, type EmailMessage, type EmailPort } from '@workspace/core';

/** Development and tests: keeps every email in memory and prints a one-line summary instead of sending. */
export class ConsoleEmailAdapter implements EmailPort {
  public readonly provider = 'console';
  public readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ id: string }> {
    this.sent.push(message);
    console.info(`[email:${message.stream}] to=${message.to} subject="${message.subject}"`);
    return { id: `console-${this.sent.length}` };
  }
}

/** Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailAdapter implements EmailPort {
  public readonly provider = 'resend';

  constructor(private readonly config: { apiKey?: string; from: string; notificationsFrom: string }) {
    if (!config.apiKey) {
      throw new AdapterUnavailableError('Email', 'resend', 'Missing RESEND_API_KEY.');
    }
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    const post = () =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: message.stream === 'notifications' ? this.config.notificationsFrom : this.config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        }),
      });
    let res = await post();
    if (res.status === 429) {
      // Resend takes a few requests a second; wait as long as it asks and try once more.
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(res.headers.get('retry-after')) || 1, 10) * 1000));
      res = await post();
    }
    if (!res.ok) {
      throw new Error(`Resend refused the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? '' };
  }
}
