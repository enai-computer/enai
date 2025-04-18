// Service responsible for managing user profile data.
// Initially, this might just return a hardcoded value.
// Later, it could read from a settings file, database, etc.

class ProfileService {
  async getProfile(): Promise<{ name?: string }> {
    // TODO: Implement actual profile fetching logic (e.g., read from config/DB)
    // For now, return a default value. Use 'friend' as per the example.
    return { name: "friend" };
  }

  // TODO: Add methods like setProfile, etc. later
}

export const profileService = new ProfileService(); 