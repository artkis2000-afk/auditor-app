import type { FirestoreGateway } from '../db/firestoreGateway.js';
import { credentialSchema, type Credential } from '../../shared/index.js';

/**
 * Репозиторий учётных данных. Коллекция `passwords`, docId = userId.
 * Старый формат документа — просто { hash }; algo подставляется схемой (sha256) для совместимости.
 */
export class CredentialRepository {
  constructor(private readonly gateway: FirestoreGateway) {}

  private map(id: string, data: Record<string, unknown>): Credential {
    return credentialSchema.parse({ userId: id, algo: data.algo, hash: data.hash });
  }

  async getByUserId(userId: string): Promise<Credential | null> {
    const doc = await this.gateway.getById('passwords', userId);
    return doc ? this.map(doc.id, doc.data) : null;
  }

  async getAll(): Promise<Credential[]> {
    const docs = await this.gateway.getAll('passwords');
    return docs.map((d) => this.map(d.id, d.data));
  }

  /** Изменяющая операция. */
  async set(credential: Credential): Promise<void> {
    await this.gateway.set('passwords', credential.userId, { algo: credential.algo, hash: credential.hash });
  }

  /** Изменяющая операция. */
  async delete(userId: string): Promise<void> {
    await this.gateway.delete('passwords', userId);
  }
}
