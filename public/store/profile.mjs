import { setKey } from '@app/api.mjs';
import { defineStore } from '@li3/store';
import { ref } from '@li3/web';
import { events as authEvents, getProfile, getPropertyNS } from 'https://auth.api.apphor.de/index.mjs';

export const useProfile = defineStore('profile', function () {
  const profile = ref(null);

  async function setProfile(v) {
    profile.value = v;
    setKey(v ? await getPropertyNS('authKey') : '');
  }

  async function reloadProfile() {
    try {
      setProfile(await getProfile());
    } catch {}
  }

  authEvents.addEventListener('state', (e) => setProfile(e.detail));

  return { profile, setProfile, reloadProfile };
});
