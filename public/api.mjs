const baseUrl = "https://__BASE_URL__";

let authKey = localStorage.getItem("__key__") || "";

export function setKey(k) {
  authKey = k;
  localStorage.setItem("__key__", k);
}

function authHeaders() {
  return { headers: { authorization: authKey } };
}

export const Workspaces = {
  async list() {
    const res = await fetch(new URL(`/workspaces`, baseUrl), authHeaders());
    if (!res.ok) {
      throw new Error(`Failed to list workspaces: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async create(name) {
    const res = await fetch(new URL(`/workspaces`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ name }),
      ...authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to create workspace: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async read(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl), authHeaders());
    if (!res.ok) {
      throw new Error(`Failed to read workspace: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async delete(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl), {
      method: "DELETE",
      ...authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to delete workspace: ${res.status} ${res.statusText}`);
    }
  },

  async readFile(name, path) {
    const url = new URL(`/workspaces/${name}/file`, baseUrl);
    url.searchParams.set("file", path);
    const res = await fetch(url, authHeaders());

    if (!res.ok) {
      throw new Error(`Failed to load workspace file: ${res.status} ${res.statusText}`);
    }

    return res.text();
  },

  async writeFile(name, path, content) {
    const url = new URL(`/workspaces/${name}/file`, baseUrl);
    url.searchParams.set("file", path);
    const res = await fetch(url, {
      method: "POST",
      body: content,
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to write workspace file: ${res.status} ${res.statusText}`);
    }

    return res.ok;
  },
};

export const Sessions = {
  async list(name) {
    const res = await fetch(new URL(`/workspaces/${name}/history`, baseUrl), authHeaders());
    if (!res.ok) {
      throw new Error(`Failed to list workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async create(name, values = {}) {
    const res = await fetch(new URL(`/workspaces/${name}/history`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ ...values }),
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to create history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async read(name, id) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}`, baseUrl), authHeaders());
    if (!res.ok) {
      throw new Error(`Failed to read workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async delete(name, id) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}`, baseUrl), {
      method: "DELETE",
      ...authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to delete workspace history: ${res.status} ${res.statusText}`);
    }
  },

  async sendMessage(name, id, m) {
    const { message, model } = m;
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}/message`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ message, model }),
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async retry(name, id) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}/retry`, baseUrl), {
      method: "POST",
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async deleteMessage(name, sessionId, uid) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${sessionId}/message/${uid}`, baseUrl), {
      method: "DELETE",
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.status} ${res.statusText}`);
    }
  },
};

export const Models = {
  async list() {
    const res = await fetch(new URL("/models", baseUrl), authHeaders());

    if (!res.ok) {
      throw new Error(`Failed to list workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async pull(name) {
    const res = await fetch(new URL("/models/" + name, baseUrl), {
      method: "POST",
      ...authHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to pull model:  ${res.status} ${res.statusText}`);
    }

    return true;
  },
};

export const events = new EventTarget();

async function init() {
  const env = await (await fetch("/.env")).json();
  if (!env.MESSAGE_HUB_URL) return;

  function connect() {
    const ws = new WebSocket(env.MESSAGE_HUB_URL);

    ws.onmessage = (e) => {
      const { eventName, data } = JSON.parse(e.data);
      events.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    };

    ws.onclose = () => setTimeout(connect, 1000);
  }

  connect();
}

init();

// const source = new EventSource("/:events");
// source.addEventListener("message", (e) => {
//   const { eventName, data } = e.data;

//   switch (eventName) {
//     case "message":
//       const { sessionId, message } = data;
//       events.dispatchEvent(new CustomEvent("message", { detail: { sessionId, message } }));
//       break;

//     default:
//       events.dispatchEvent(new CustomEvent("event", { detail: data }));
//   }
// });
