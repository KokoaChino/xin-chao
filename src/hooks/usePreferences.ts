import { useEffect, useSyncExternalStore } from 'react';
import {
  createDefaultPreferences,
  exportPreferences,
  isSafeIdentityId,
  validatePreferences,
} from '../data/preferences';
import { browserStorage } from '../data/storage';
import type { BrowserStorage, PreferencesRecord } from '../data/storage';
import type { Preferences, Tier } from '../types';

type PreferenceUpdate = Partial<Preferences> | ((current: Preferences) => Preferences);

interface PreferenceSnapshot {
  preferences: Preferences;
  ready: boolean;
  error: string | null;
}

export interface PreferencesController extends PreferenceSnapshot {
  update(updater: PreferenceUpdate): void;
  add(id: string): void;
  remove(id: string): void;
  reorder(ids: string[]): void;
  setNote(id: string, text: string): void;
  setTier(id: string, tier: Tier | null): void;
  toggleFavorite(id: string): void;
  importPreferences(input: unknown): Promise<void>;
  reset(): Promise<void>;
  exportData(): string;
}

export function createPreferencesStore(storage: BrowserStorage = browserStorage) {
  let snapshot: PreferenceSnapshot = {
    preferences: createDefaultPreferences(),
    ready: false,
    error: null,
  };
  let initialization: Promise<void> | null = null;
  let mutationCount = 0;
  let persistedRevision = 0;
  let remoteUpdatePending = false;
  const pending: { apply: (current: Preferences) => Preferences }[] = [];
  const writing = new Set<Promise<void>>();
  const listeners = new Set<() => void>();

  function publish(changes: Partial<PreferenceSnapshot>) {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  }

  storage.subscribeStatus(() => publish({ error: storage.getStatus().reason }));
  function acceptRecord(record: PreferencesRecord) {
    if (record.revision < persistedRevision) return;
    if (pending.length) {
      remoteUpdatePending = true;
      return;
    }
    persistedRevision = record.revision;
    publish({
      preferences: record.preferences ? validatePreferences(record.preferences) : createDefaultPreferences(),
      ready: true,
      error: storage.getStatus().reason,
    });
  }
  storage.subscribePreferences((record) => {
    try {
      acceptRecord(record);
    } catch {
      publish({ error: '另一标签页的排行榜数据无法读取，已保留当前内容。' });
    }
  });

  function initialize() {
    if (initialization) return initialization;
    const startingMutation = mutationCount;
    initialization = (async () => {
      try {
        const record = await storage.getPreferencesRecord();
        if (mutationCount === startingMutation) {
          acceptRecord(record);
        }
        publish({ ready: true, error: storage.getStatus().reason });
      } catch {
        publish({ ready: true, error: '保存的排行榜数据无法读取。可以导入备份恢复，或重新开始排列。' });
      }
    })();
    return initialization;
  }

  function commit(
    apply: (current: Preferences) => Preferences,
    expectedRevision?: number,
  ): Promise<void> {
    const preferences = validatePreferences(apply(structuredClone(snapshot.preferences)));
    const mutation = { apply };
    mutationCount += 1;
    pending.push(mutation);
    publish({ preferences, ready: true, error: storage.getStatus().reason });
    const operation = storage.updatePreferences((saved) => validatePreferences(
      apply(saved ? validatePreferences(saved) : createDefaultPreferences()),
    ), expectedRevision);
    let failure: unknown;
    const settled = operation.then(async (record) => {
      pending.splice(pending.indexOf(mutation), 1);
      persistedRevision = record.revision;
      let optimistic = validatePreferences(record.preferences);
      for (const queued of pending) {
        optimistic = validatePreferences(queued.apply(structuredClone(optimistic)));
      }
      publish({ preferences: optimistic, ready: true, error: storage.getStatus().reason });
      if (!pending.length && remoteUpdatePending) {
        remoteUpdatePending = false;
        acceptRecord(await storage.getPreferencesRecord());
      }
    }, async (error: unknown) => {
      failure = error;
      pending.splice(pending.indexOf(mutation), 1);
      const record = await storage.getPreferencesRecord();
      if (!pending.length) acceptRecord(record);
      publish({
        error: error instanceof Error ? error.message : '排行榜保存失败，已保留上次成功保存的内容。',
      });
    }).catch((error: unknown) => {
      failure = error;
      publish({ error: '排行榜保存状态无法确认，请导出备份后重新打开页面。' });
    });
    writing.add(settled);
    void settled.finally(() => writing.delete(settled));
    const confirmation = settled.then(() => {
      if (failure !== undefined) throw failure;
    });
    void confirmation.catch(() => undefined);
    return confirmation;
  }

  function update(updater: PreferenceUpdate) {
    const updatedAt = new Date().toISOString();
    commit((current) => {
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return { ...next, schemaVersion: 1, updatedAt };
    });
  }

  function checkId(id: string) {
    if (!isSafeIdentityId(id)) throw new Error('角色标识无效，无法保存。');
  }

  const actions = {
    update,
    add(id: string) {
      checkId(id);
      if (!snapshot.preferences.order.includes(id)) {
        update((current) => ({
          ...current,
          order: current.order.includes(id) ? current.order : [...current.order, id],
        }));
      }
    },
    remove(id: string) {
      update((current) => ({ ...current, order: current.order.filter((entry) => entry !== id) }));
    },
    reorder(ids: string[]) {
      if (new Set(ids).size !== ids.length || !ids.every(isSafeIdentityId)) {
        throw new Error('排名包含重复或无效的角色。');
      }
      update((current) => {
        const existing = new Set(current.order);
        const reordered = ids.filter((id) => existing.has(id));
        const included = new Set(reordered);
        return { ...current, order: [...reordered, ...current.order.filter((id) => !included.has(id))] };
      });
    },
    setNote(id: string, text: string) {
      checkId(id);
      update((current) => {
        const notes = { ...current.notes };
        if (text) notes[id] = text;
        else delete notes[id];
        return { ...current, notes };
      });
    },
    setTier(id: string, tier: Tier | null) {
      checkId(id);
      update((current) => {
        const tiers = { ...current.tiers };
        if (tier) tiers[id] = tier;
        else delete tiers[id];
        return { ...current, tiers };
      });
    },
    toggleFavorite(id: string) {
      checkId(id);
      update((current) => ({
        ...current,
        favorites: current.favorites.includes(id)
          ? current.favorites.filter((entry) => entry !== id)
          : [...current.favorites, id],
      }));
    },
    importPreferences(input: unknown) {
      const imported = validatePreferences(input);
      return commit(() => imported, persistedRevision + pending.length);
    },
    reset() {
      return commit(() => createDefaultPreferences(), persistedRevision + pending.length);
    },
    exportData() {
      return exportPreferences(snapshot.preferences);
    },
  };

  return {
    actions,
    initialize,
    async whenIdle() {
      while (writing.size) await Promise.all([...writing]);
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const preferencesStore = createPreferencesStore();

export function usePreferences(): PreferencesController {
  const snapshot = useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getSnapshot,
    preferencesStore.getSnapshot,
  );
  useEffect(() => { void preferencesStore.initialize(); }, [preferencesStore]);
  return { ...snapshot, ...preferencesStore.actions };
}
