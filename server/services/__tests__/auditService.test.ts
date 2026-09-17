import { describe, it, expect } from 'vitest';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { AuditService } from '../auditService.js';
import { countingClock, countingIds } from './_helpers.js';

function makeService() {
  const gw = new InMemoryGateway();
  const ctx = createServiceContext(gw, { clock: countingClock(), ids: countingIds() });
  return { gw, ctx, audit: new AuditService(ctx) };
}

describe('AuditService', () => {
  it('log записывает запись с id, временем и дефолтами', async () => {
    const { audit, ctx } = makeService();
    const entry = await audit.log({
      userId: 'u-admin',
      username: 'admin',
      action: 'invoice_edit',
      entityType: 'invoice',
      entityId: 'inv-1',
    });
    expect(entry.id).toBe('al-1');
    expect(entry.timestamp).toBe('2026-09-17T00:00:00.000Z');
    expect(entry.oldValues).toBeNull();
    expect(entry.newValues).toBeNull();

    const stored = await ctx.repositories.auditLogs.getAll();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.action).toBe('invoice_edit');
  });

  it('list возвращает записи по убыванию времени', async () => {
    const { audit } = makeService();
    await audit.log({ userId: 'u', username: 'a', action: 'A', entityType: 'x', entityId: '1' });
    await audit.log({ userId: 'u', username: 'a', action: 'B', entityType: 'x', entityId: '2' });
    const list = await audit.list();
    expect(list.map((l) => l.action)).toEqual(['B', 'A']); // новейшая первой
  });

  it('list уважает limit', async () => {
    const { audit } = makeService();
    await audit.log({ userId: 'u', username: 'a', action: 'A', entityType: 'x', entityId: '1' });
    await audit.log({ userId: 'u', username: 'a', action: 'B', entityType: 'x', entityId: '2' });
    const list = await audit.list(1);
    expect(list).toHaveLength(1);
    expect(list[0]!.action).toBe('B');
  });

  it('сохраняет old/new снимки', async () => {
    const { audit } = makeService();
    const e = await audit.log({
      userId: 'u',
      username: 'a',
      action: 'nomenclature_edit',
      entityType: 'nomenclature',
      entityId: 'n-1',
      oldValues: { normativeServiceDays: 180 },
      newValues: { normativeServiceDays: 90 },
    });
    expect(e.oldValues).toEqual({ normativeServiceDays: 180 });
    expect(e.newValues).toEqual({ normativeServiceDays: 90 });
  });
});
