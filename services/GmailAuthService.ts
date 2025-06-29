import { BaseService } from './base/BaseService';
import { GmailAuthError } from './base/ServiceError';
import type Database from 'better-sqlite3';
import { OAuth2Client } from 'google-auth-library';
import type { ProfileService } from './ProfileService';

interface GmailAuthServiceDeps {
  db: Database.Database;
  profileService: ProfileService;
}

export class GmailAuthService extends BaseService<GmailAuthServiceDeps> {
  private oauth2Client!: OAuth2Client;

  constructor(deps: GmailAuthServiceDeps) {
    super('GmailAuthService', deps);
  }

  async initialize(): Promise<void> {
    await super.initialize();
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = process.env.GMAIL_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new GmailAuthError('Missing Gmail OAuth environment variables');
    }

    this.oauth2Client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri
    });
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return this.oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      // TODO: store tokens securely per user
      // Placeholder in-memory storage (not persisted)
      this.tokenStore.set(userId, tokens);
    } catch (error) {
      this.logError('Auth callback failed', error);
      throw new GmailAuthError('Failed to authenticate with Gmail');
    }
  }

  private tokenStore = new Map<string, any>();

  async getAuthenticatedClient(userId: string): Promise<OAuth2Client> {
    const tokens = this.tokenStore.get(userId);
    if (!tokens) {
      throw new GmailAuthError('No tokens found for user');
    }
    this.oauth2Client.setCredentials(tokens);
    return this.oauth2Client;
  }
}
