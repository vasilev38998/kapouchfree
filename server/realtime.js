import { randomUUID } from 'node:crypto';

const MAX_EVENTS = 1000;
const events = [];
let sequence = 0;

export function publishEvent({ type, recipientPhone = null, actorPhone = null, payload = {} }) {
  const event = {
    id: ++sequence,
    eventId: randomUUID(),
    type,
    recipientPhone,
    actorPhone,
    payload,
    createdAt: new Date().toISOString()
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return event;
}

export function getEventsAfter(cursor = 0, recipientPhone) {
  const after = Number(cursor) || 0;
  return events.filter(event => event.id > after && (!event.recipientPhone || event.recipientPhone === recipientPhone));
}

export function latestCursor() {
  return sequence;
}
