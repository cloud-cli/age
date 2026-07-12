/** @type {Set<WeakRef>} */
const listeners = new Set();

/** @param {import('http').ServerResponse} client */
export function subscribe(client) {
  listeners.push(new WeakRef(client));
}

export function publish(event) {
  for (const ref of listeners) {
    const stream = ref.deref();
    if (!stream || stream.detached || !stream.writable) {
      listeners.delete(ref);
      continue;
    }

    stream.write(`data: ${JSON.stringify({ event })}\n\n`);
  }
}
