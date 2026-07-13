/** @type {Set<WeakRef>} */
const listeners = new Set();

/** @param {import('http').ServerResponse} client */
export function subscribe(client) {
  listeners.add(new WeakRef(client));
}

export function publish(eventName, data) {
  for (const ref of listeners) {
    const stream = ref.deref();
    if (!stream || stream.detached || !stream.writable) {
      listeners.delete(ref);
      continue;
    }

    stream.write(`data: ${JSON.stringify({ eventName, data })}\n\n`);
  }
}
