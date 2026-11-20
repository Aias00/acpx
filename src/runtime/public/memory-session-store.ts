import { assertPersistedKeyPolicy } from "../../persisted-key-policy.js";
import { parseSessionRecord } from "../../session/persistence/parse.js";
import { serializeSessionRecordForDisk } from "../../session/persistence/serialize.js";
import type { AcpSessionRecord, AcpSessionStore } from "./contract.js";

class MemorySessionStore implements AcpSessionStore {
  private readonly records = new Map<string, string>();

  async load(sessionId: string): Promise<AcpSessionRecord | undefined> {
    const payload = this.records.get(sessionId);
    if (payload === undefined) {
      return undefined;
    }
    const record = parseSessionRecord(JSON.parse(payload));
    return record?.acpxRecordId === sessionId ? record : undefined;
  }

  async save(record: AcpSessionRecord): Promise<void> {
    const persisted = serializeSessionRecordForDisk(record);
    assertPersistedKeyPolicy(persisted);
    this.records.set(record.acpxRecordId, JSON.stringify(persisted));
  }
}

export function createMemorySessionStore(): AcpSessionStore {
  return new MemorySessionStore();
}
