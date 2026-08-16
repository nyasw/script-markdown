import * as vscode from 'vscode';

export interface SpeakerUsageRecord {
  speakerName: string;
  count: number;
  lastUsedTimestamp: number;
}

export class SpeakerUsageTracker {
  private static readonly STORAGE_KEY = 'smd.speakerUsageData';

  constructor(private context: vscode.ExtensionContext) {}

  public getUsageMap(): Map<string, SpeakerUsageRecord> {
    const rawData = this.context.globalState.get<Record<string, SpeakerUsageRecord>>(SpeakerUsageTracker.STORAGE_KEY, {});
    return new Map(Object.entries(rawData));
  }

  public recordUsage(speakerName: string): void {
    if (!speakerName) return;

    const rawData = this.context.globalState.get<Record<string, SpeakerUsageRecord>>(SpeakerUsageTracker.STORAGE_KEY, {});
    const existing = rawData[speakerName] || { speakerName, count: 0, lastUsedTimestamp: Date.now() };

    rawData[speakerName] = {
      speakerName,
      count: existing.count + 1,
      lastUsedTimestamp: Date.now()
    };

    this.context.globalState.update(SpeakerUsageTracker.STORAGE_KEY, rawData);
  }

  public getUsageCount(speakerName: string): number {
    const rawData = this.context.globalState.get<Record<string, SpeakerUsageRecord>>(SpeakerUsageTracker.STORAGE_KEY, {});
    return rawData[speakerName]?.count || 0;
  }

  public getSpeakerScore(speakerName: string, speakerId?: string): number {
    const countByName = this.getUsageCount(speakerName);
    const countById = speakerId ? this.getUsageCount(speakerId) : 0;
    const totalCount = Math.max(countByName, countById);

    if (totalCount === 0) {
      return 0;
    }

    const rawData = this.context.globalState.get<Record<string, SpeakerUsageRecord>>(SpeakerUsageTracker.STORAGE_KEY, {});
    const rec = rawData[speakerName] || (speakerId ? rawData[speakerId] : undefined);
    const lastUsed = rec?.lastUsedTimestamp || 0;

    const daysSinceLastUse = (Date.now() - lastUsed) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.max(0, 10 - daysSinceLastUse);

    return (totalCount * 10) + recencyWeight;
  }
}
