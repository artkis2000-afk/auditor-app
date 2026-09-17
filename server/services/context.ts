import type { FirestoreGateway } from '../db/firestoreGateway.js';
import { createRepositories, type Repositories } from '../repositories/index.js';

/** Источник времени (инъекция для детерминизма в тестах). */
export interface Clock {
  now(): string; // ISO-строка
}

/** Генератор идентификаторов (инъекция для детерминизма в тестах). */
export interface IdGenerator {
  generate(prefix: string): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const randomIdGenerator: IdGenerator = {
  generate: (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
};

/**
 * Контекст сервисов: репозитории (поверх шлюза Firestore), часы и генератор id.
 * Сервисы получают всё через контекст — это упрощает тесты (in-memory шлюз + детерминизм).
 */
export interface ServiceContext {
  gateway: FirestoreGateway;
  repositories: Repositories;
  clock: Clock;
  ids: IdGenerator;
}

export function createServiceContext(
  gateway: FirestoreGateway,
  opts: { clock?: Clock; ids?: IdGenerator } = {},
): ServiceContext {
  return {
    gateway,
    repositories: createRepositories(gateway),
    clock: opts.clock ?? systemClock,
    ids: opts.ids ?? randomIdGenerator,
  };
}
