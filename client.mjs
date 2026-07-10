const baseUrl = "https://__BASE_URL__";

export const workspaces = {
  async list() {
    const res = await fetch(new URL(`/workspaces`, baseUrl));
    if (!res.ok) {
      throw new Error(
        `Failed to list workspaces: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  },

  async create() {
    const res = await fetch(new URL(`/workspaces`, baseUrl), {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(
        `Failed to create workspace: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  },

  async read(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl));
    if (!res.ok) {
      throw new Error(
        `Failed to read workspace: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  },

  async delete(name) {
    const res = await fetch(new URL(`/workspaces/${name}`, baseUrl), {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(
        `Failed to delete workspace: ${res.status} ${res.statusText}`,
      );
    }
  },
};

export const history = {
  async list(name) {
    const res = await fetch(new URL(`/workspaces/${name}/history`, baseUrl));
    if (!res.ok) {
      throw new Error(
        `Failed to list workspace history: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  },

  async read(name, id) {
    const res = await fetch(
      new URL(`/workspaces/${name}/history/${id}`, baseUrl),
    );
    if (!res.ok) {
      throw new Error(
        `Failed to read workspace history: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  },

  async delete(name, id) {
    const res = await fetch(
      new URL(`/workspaces/${name}/history/${id}`, baseUrl),
      { method: "DELETE" },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to delete workspace history: ${res.status} ${res.statusText}`,
      );
    }
  },
};
