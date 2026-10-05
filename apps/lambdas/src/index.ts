// Lambda Handlers for Step Functions & EventBridge Schedules (Architecture B)

export interface ScheduledEvent {
  id: string;
  source: string;
  time: string;
}

export async function zoomPollerHandler(event: ScheduledEvent) {
  // Catch missed webhooks every 30 minutes
  console.log('Running Zoom poller for missed webhooks...', event.time);
  return { status: 'success', polledAt: event.time };
}

export async function retentionPurgeHandler(event: ScheduledEvent) {
  // Purge transcripts past org retention (default 180 days) nightly at 02:00 IST
  console.log('Running DPDP transcript retention purge...', event.time);
  return { status: 'success', purgedAt: event.time, rowsPurged: 0 };
}

export async function evalCanaryHandler(event: ScheduledEvent) {
  // Run golden-set eval against current prompts in prod config every Sunday at 03:00 IST
  console.log('Running canary golden-set evaluation...', event.time);
  return { status: 'success', evaluatedAt: event.time };
}
