const baseUrl = "https://__BASE_URL__";

let authKey = "";

export function setKey(k) {
  authKey = k;
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
};

export const Models = {
  async list() {
    const res = await fetch(new URL("/models", baseUrl), authHeaders());

    if (!res.ok) {
      throw new Error(`Failed to list workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },
};
