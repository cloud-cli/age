const messageHub = process.env.MESSAGE_HUB_URL;

export function publish(eventName, data) {
  if (!messageHub) return;

  const url = new URL("/publish", messageHub);
  fetch(url, {
    method: "POST",
    body: JSON.stringify({ eventName, data }),
  });
}
