const baseUrl = "https://__BASE_URL__";

export const workspaces = {
  async list() {
    const res = await fetch(new URL(`/workspaces`, baseUrl));
    if (!res.ok) {
      throw new Error(`Failed to list workspaces: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async create(name) {
    const res = await fetch(new URL(`/workspaces`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create workspace: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async read(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl));
    if (!res.ok) {
      throw new Error(`Failed to read workspace: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async delete(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl), {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to delete workspace: ${res.status} ${res.statusText}`);
    }
  },
};

export const history = {
  async list(name) {
    const res = await fetch(new URL(`/workspaces/${name}/history`, baseUrl));
    if (!res.ok) {
      throw new Error(`Failed to list workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async create(name, values = {}) {
    const res = await fetch(new URL(`/workspaces/${name}/history`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ ...values }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async read(name, id) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}`, baseUrl));
    if (!res.ok) {
      throw new Error(`Failed to read workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  async delete(name, id) {
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}`, baseUrl), { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Failed to delete workspace history: ${res.status} ${res.statusText}`);
    }
  },

  async sendMessage(name, id, m) {
    const { message, model } = m;
    const res = await fetch(new URL(`/workspaces/${name}/history/${id}/message`, baseUrl), {
      method: "POST",
      body: JSON.stringify({ message, model }),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },
};

export const models = {
  async list() {
    const res = await fetch(new URL("/models", baseUrl));

    if (!res.ok) {
      throw new Error(`Failed to list workspace history: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },
};
