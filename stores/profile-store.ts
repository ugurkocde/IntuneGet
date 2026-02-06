import { create } from 'zustand';

interface ProfileState {
  profileImage: string | null;
  isLoading: boolean;
  hasFetched: boolean;
}

interface ProfileActions {
  fetchProfileImage: (token: string) => Promise<void>;
  setProfileImage: (image: string | null) => void;
  uploadProfileImage: (token: string, image: string) => Promise<void>;
  removeProfileImage: (token: string) => Promise<void>;
}

type ProfileStore = ProfileState & ProfileActions;

export const useProfileStore = create<ProfileStore>()((set, get) => ({
  profileImage: null,
  isLoading: false,
  hasFetched: false,

  fetchProfileImage: async (token: string) => {
    if (get().hasFetched) return;

    set({ isLoading: true });
    try {
      const res = await fetch('/api/profile/image', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        set({ profileImage: data.image, hasFetched: true });
      }
    } catch {
      // Silently fail - will fall back to initials
    } finally {
      set({ isLoading: false });
    }
  },

  setProfileImage: (image: string | null) => {
    set({ profileImage: image });
  },

  uploadProfileImage: async (token: string, image: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/profile/image', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image }),
      });
      if (res.ok) {
        set({ profileImage: image });
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to upload image');
      }
    } finally {
      set({ isLoading: false });
    }
  },

  removeProfileImage: async (token: string) => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/profile/image', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ profileImage: null });
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));
