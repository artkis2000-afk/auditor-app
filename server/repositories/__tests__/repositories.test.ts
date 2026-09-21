import { describe, it, expect } from 'vitest';
import { InMemoryGateway } from './inMemoryGateway.js';
import {
  createRepositories,
  RepositoryError,
  SupplierRepository,
  InvoiceRepository,
} from '../index.js';

const ts = '2026-06-01T12:00:00.000Z';

describe('FirestoreRepository (через SupplierRepository) — чтение + валидация', () => {
  it('getAll подставляет дефолты схемы для необязательных полей', async () => {
    const gw = new InMemoryGateway({
      suppliers: [{ id: 's-1', name: 'ООО Тест', inn: '7712345678', createdAt: ts, updatedAt: ts }],
    });
    const repo = new SupplierRepository(gw);
    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.legalAddress).toBe('');
    expect(all[0]!.isApproved).toBe(true);
    expect(all[0]!.deletedAt).toBeNull();
  });

  it('getById возвращает null для отсутствующего документа', async () => {
    const repo = new SupplierRepository(new InMemoryGateway());
    expect(await repo.getById('nope')).toBeNull();
  });

  it('upsert записывает документ в шлюз', async () => {
    const gw = new InMemoryGateway();
    const repo = new SupplierRepository(gw);
    await repo.upsert({
      id: 's-9',
      name: 'Новый',
      legalAddress: '',
      inn: '1234567890',
      isApproved: true,
      notes: '',
      createdBy: 'u-admin',
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    });
    const back = await repo.getById('s-9');
    expect(back?.name).toBe('Новый');
  });

  it('delete удаляет документ', async () => {
    const gw = new InMemoryGateway({
      suppliers: [{ id: 's-1', name: 'X', inn: '1', createdAt: ts, updatedAt: ts }],
    });
    const repo = new SupplierRepository(gw);
    await repo.delete('s-1');
    expect(await repo.getById('s-1')).toBeNull();
  });

  it('некорректный документ → RepositoryError', async () => {
    const gw = new InMemoryGateway({
      suppliers: [{ id: 'bad', inn: '1', createdAt: ts, updatedAt: ts }], // нет обязательного name
    });
    const repo = new SupplierRepository(gw);
    await expect(repo.getAll()).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe('InvoiceRepository.listActive', () => {
  it('фильтрует удалённые (deletedAt)', async () => {
    const gw = new InMemoryGateway({
      invoices: [
        { id: 'a', recognizedDate: '2026-07-01', status: 'confirmed', uploadedBy: 'u', createdAt: ts, updatedAt: ts, deletedAt: null },
        { id: 'b', recognizedDate: '2026-07-02', status: 'confirmed', uploadedBy: 'u', createdAt: ts, updatedAt: ts, deletedAt: ts },
      ],
    });
    const repo = new InvoiceRepository(gw);
    const active = await repo.listActive();
    expect(active.map((i) => i.id)).toEqual(['a']);
  });
});

describe('SettingsRepository (settings/global)', () => {
  it('get → дефолты, если документа нет', async () => {
    const { settings } = createRepositories(new InMemoryGateway());
    const s = await settings.get();
    expect(s.anomalyThreshold).toBe(10);
    expect(s.duplicateDays).toBe(180);
    expect(s.aiOcrEngine).toBe('gemini');
  });

  it('set + get сохраняют значения', async () => {
    const gw = new InMemoryGateway();
    const { settings } = createRepositories(gw);
    await settings.set({ anomalyThreshold: 25, duplicateDays: 90, aiOcrEngine: 'gemini-pro' });
    const s = await settings.get();
    expect(s.anomalyThreshold).toBe(25);
    expect(s.duplicateDays).toBe(90);
    expect(s.aiOcrEngine).toBe('gemini-pro');
  });
});

describe('UserRepository (профиль users/{uid})', () => {
  it('getById читает профиль по uid', async () => {
    const gw = new InMemoryGateway({
      users: [
        { id: 'uid-1', username: 'owner@example.com', fullName: 'Владелец', role: 'admin', isActive: true, createdAt: ts },
      ],
    });
    const { users } = createRepositories(gw);
    const u = await users.getById('uid-1');
    expect(u?.username).toBe('owner@example.com');
    expect(u?.email).toBeNull(); // отсутствующее поле → дефолт схемы
  });
});
