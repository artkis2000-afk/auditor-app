import { describe, it, expect } from 'vitest';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { UserService } from '../userService.js';

function ctxWith() {
  return createServiceContext(new InMemoryGateway({}));
}

describe('UserService.getOrCreateProfile (bootstrap)', () => {
  it('создаёт профиль users/{uid} при первом входе (default-deny: viewer)', async () => {
    const ctx = ctxWith();
    const svc = new UserService(ctx);
    const p = await svc.getOrCreateProfile({
      uid: 'uid-1',
      email: 'a@b.com',
      emailVerified: true,
      name: 'Имя',
      picture: 'http://x/p.png',
    });
    expect(p.id).toBe('uid-1');
    expect(p.email).toBe('a@b.com');
    expect(p.displayName).toBe('Имя');
    expect(p.photoURL).toBe('http://x/p.png');
    expect(p.role).toBe('viewer');
    expect(p.isActive).toBe(true);
    expect(await ctx.repositories.users.getById('uid-1')).not.toBeNull();
  });

  it('email в allowlist → admin (регистр не важен)', async () => {
    const ctx = ctxWith();
    const svc = new UserService(ctx, { adminEmails: ['A@B.com'] });
    const p = await svc.getOrCreateProfile({ uid: 'uid-2', email: 'a@b.com' });
    expect(p.role).toBe('admin');
  });

  it('повторный вызов возвращает существующий профиль (не пересоздаёт)', async () => {
    const ctx = ctxWith();
    const svc = new UserService(ctx);
    const first = await svc.getOrCreateProfile({ uid: 'uid-3', email: 'x@y.com' });
    await ctx.repositories.users.upsert({ ...first, role: 'admin' }); // ручное изменение роли в БД
    const again = await svc.getOrCreateProfile({ uid: 'uid-3', email: 'x@y.com' });
    expect(again.role).toBe('admin'); // взят существующий, не перезаписан на viewer
    expect(again.createdAt).toBe(first.createdAt);
  });

  it('без email → username/fullName = uid, email=null', async () => {
    const ctx = ctxWith();
    const svc = new UserService(ctx);
    const p = await svc.getOrCreateProfile({ uid: 'uid-4' });
    expect(p.username).toBe('uid-4');
    expect(p.fullName).toBe('uid-4');
    expect(p.email).toBeNull();
  });

  it('toAuthUser маппит профиль в principal (id=uid)', async () => {
    const ctx = ctxWith();
    const svc = new UserService(ctx);
    const p = await svc.getOrCreateProfile({ uid: 'uid-5', email: 'p@q.com', name: 'PQ' });
    const au = svc.toAuthUser(p, { uid: 'uid-5', email: 'p@q.com', emailVerified: true });
    expect(au).toMatchObject({
      id: 'uid-5',
      username: 'p@q.com',
      fullName: 'PQ',
      role: 'viewer',
      email: 'p@q.com',
      emailVerified: true,
    });
  });
});
