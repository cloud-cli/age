import { defineStore } from "@li3/store";
import { ref } from "@li3/web";

export function signIn() {
  window.location.assign("/auth/login");
}

export async function signOut() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.assign("/");
}

export const useProfile = defineStore("profile", function () {
  const profile = ref(null);

  async function reloadProfile() {
    try {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      profile.value = response.ok ? await response.json() : null;
    } catch {
      profile.value = null;
    }
  }

  return { profile, reloadProfile };
});
