import type { AuthUser, User, UserRole } from '../../shared/index.js';
import type { FirebaseIdentity } from '../auth/firebaseTokenVerifier.js';
import type { ServiceContext } from './context.js';

/**
 * Профиль пользователя приложения поверх Firebase-личности (PHASE 5.1).
 *
 * Bootstrap: `getOrCreateProfile` вызывается authenticate-middleware на КАЖДОМ запросе;
 * при первом входе создаёт `users/{uid}` (uid из ПРОВЕРЕННОГО токена, не из тела запроса).
 *
 * Переходная роль (до 5.2 membership): admin для email из allowlist, иначе viewer (default-deny).
 * Роль/username в профиле сохраняют совместимость с текущей authorization (requireRole и т.п.).
 */
export interface UserServiceOptions {
  /** Email'ы, получающие role=admin при первом создании профиля (нижний регистр). */
  adminEmails?: string[];
}

export class UserService {
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly ctx: ServiceContext,
    opts: UserServiceOptions = {},
  ) {
    this.adminEmails = new Set((opts.adminEmails ?? []).map((e) => e.toLowerCase()));
  }

  /** Возвращает профиль users/{uid}, создавая его при первом обращении. */
  async getOrCreateProfile(identity: FirebaseIdentity): Promise<User> {
    const existing = await this.ctx.repositories.users.getById(identity.uid);
    if (existing) return existing;

    const now = this.ctx.clock.now();
    const email = identity.email ?? null;
    const displayName = identity.name ?? null;
    const profile: User = {
      id: identity.uid,
      username: email ?? identity.uid, // совместимость
      fullName: displayName ?? email ?? identity.uid, // совместимость
      role: this.initialRole(email),
      isActive: true,
      createdAt: now,
      email,
      displayName,
      photoURL: identity.picture ?? null,
      updatedAt: now,
    };
    await this.ctx.repositories.users.upsert(profile);
    return profile;
  }

  /** Маппинг профиля в публичный AuthUser (req.principal). */
  toAuthUser(profile: User, identity?: FirebaseIdentity): AuthUser {
    return {
      id: profile.id,
      username: profile.username,
      fullName: profile.fullName,
      role: profile.role,
      email: profile.email ?? identity?.email ?? null,
      emailVerified: identity?.emailVerified,
    };
  }

  private initialRole(email: string | null): UserRole {
    if (email && this.adminEmails.has(email.toLowerCase())) return 'admin';
    return 'viewer';
  }
}
