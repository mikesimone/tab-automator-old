import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _pushToSync, _pullFromSyncIfNewer, LOCAL_SYNC_HASH_KEY } from '../syncStorage';
import { STORAGE_KEY_METADATA, STORAGE_KEY_CHUNK_PREFIX } from '../storage';
import { TabModifierSettings } from '../types';

function makeConfig(overrides: Partial<TabModifierSettings['settings']> = {}): TabModifierSettings {
	return {
		rules: [],
		groups: [],
		settings: {
			enable_new_version_notification: false,
			theme: 'tabee',
			lightweight_mode_enabled: false,
			lightweight_mode_patterns: [],
			lightweight_mode_apply_to_rules: true,
			lightweight_mode_apply_to_tab_hive: true,
			auto_close_enabled: false,
			auto_close_timeout: 30,
			tab_hive_reject_list: [],
			debug_mode: false,
			auto_backup_enabled: false,
			sync_enabled: true,
			...overrides,
		},
	};
}

function makeStorageArea(store: Record<string, any>) {
	return {
		get: vi.fn((keys: string[] | null, callback: (items: any) => void) => {
			if (keys === null) {
				callback({ ...store });
				return;
			}
			const result: Record<string, any> = {};
			(Array.isArray(keys) ? keys : [keys]).forEach((key) => {
				if (key in store) result[key] = store[key];
			});
			callback(result);
		}),
		set: vi.fn((items: Record<string, any>, callback?: () => void) => {
			Object.assign(store, items);
			callback?.();
		}),
		remove: vi.fn((keys: string | string[], callback?: () => void) => {
			(Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]);
			callback?.();
		}),
	};
}

let localStore: Record<string, any>;
let syncStore: Record<string, any>;
let syncArea: ReturnType<typeof makeStorageArea> & { QUOTA_BYTES: number; MAX_ITEMS: number };

describe('syncStorage', () => {
	beforeEach(() => {
		localStore = {};
		syncStore = {};
		syncArea = Object.assign(makeStorageArea(syncStore), {
			QUOTA_BYTES: 102400,
			MAX_ITEMS: 512,
		});

		// @ts-expect-error - global is from vitest setup; see storage.test.ts for the same pattern
		global.chrome = {
			runtime: { lastError: null },
			storage: {
				local: makeStorageArea(localStore),
				sync: syncArea,
			},
		};
	});

	describe('_pushToSync', () => {
		it('returns "disabled" and writes nothing when sync is off', async () => {
			const result = await _pushToSync(makeConfig({ sync_enabled: false }));

			expect(result).toBe('disabled');
			expect(Object.keys(syncStore)).toHaveLength(0);
		});

		it('writes chunked config + metadata to sync on first push', async () => {
			const config = makeConfig();
			config.rules.push({
				id: 'r1',
				is_enabled: true,
				name: 'Test rule',
				detection: 'CONTAINS',
				url_fragment: 'example.com',
				tab: {
					title: 'Example',
					icon: null,
					pinned: false,
					protected: false,
					unique: false,
					muted: false,
					title_matcher: null,
					url_matcher: null,
					group_id: null,
				},
			});

			const result = await _pushToSync(config);

			expect(result).toBe('ok');
			expect(syncStore[STORAGE_KEY_METADATA]).toBeDefined();
			expect(syncStore[STORAGE_KEY_METADATA].chunkCount).toBeGreaterThan(0);
			expect(syncStore[`${STORAGE_KEY_CHUNK_PREFIX}0`]).toBeTypeOf('string');
			expect(localStore[LOCAL_SYNC_HASH_KEY]).toBe(syncStore[STORAGE_KEY_METADATA].hash);
		});

		it('is a no-op ("unchanged") when pushing identical content twice', async () => {
			const config = makeConfig();

			await _pushToSync(config);
			const setCallsAfterFirst = syncArea.set.mock.calls.length;

			const result = await _pushToSync(config);

			expect(result).toBe('unchanged');
			expect(syncArea.set.mock.calls.length).toBe(setCallsAfterFirst);
		});

		it('cleans up stale chunk keys when a new push has fewer chunks than the last', async () => {
			const big = makeConfig();
			for (let i = 0; i < 200; i++) {
				big.rules.push({
					id: `r${i}`,
					is_enabled: true,
					name: `Rule number ${i} with a fairly long descriptive name to bulk up size`,
					detection: 'CONTAINS',
					url_fragment: `example${i}.com/some/long/path/fragment`,
					tab: {
						title: `Title for rule ${i}`,
						icon: null,
						pinned: false,
						protected: false,
						unique: false,
						muted: false,
						title_matcher: null,
						url_matcher: null,
						group_id: null,
					},
				});
			}

			await _pushToSync(big);
			const previousChunkCount = syncStore[STORAGE_KEY_METADATA].chunkCount;
			expect(previousChunkCount).toBeGreaterThan(1);

			await _pushToSync(makeConfig());

			expect(syncStore[STORAGE_KEY_METADATA].chunkCount).toBe(1);
			expect(syncStore[`${STORAGE_KEY_CHUNK_PREFIX}${previousChunkCount - 1}`]).toBeUndefined();
		});

		it('returns "too-large" and writes nothing when the config exceeds the sync quota', async () => {
			syncArea.QUOTA_BYTES = 100; // tiny quota, easy to exceed

			const result = await _pushToSync(makeConfig());

			expect(result).toBe('too-large');
			expect(Object.keys(syncStore)).toHaveLength(0);
		});
	});

	describe('_pullFromSyncIfNewer', () => {
		it('returns "no-data" when sync has nothing stored', async () => {
			const result = await _pullFromSyncIfNewer();

			expect(result.status).toBe('no-data');
		});

		it('returns "unchanged" when the remote hash matches what we last saw', async () => {
			await _pushToSync(makeConfig());

			const result = await _pullFromSyncIfNewer();

			expect(result.status).toBe('unchanged');
		});

		it('returns "updated" with decompressed data when sync has content we have not seen', async () => {
			const config = makeConfig();
			config.rules.push({
				id: 'remote-rule',
				is_enabled: true,
				name: 'From another device',
				detection: 'CONTAINS',
				url_fragment: 'example.com',
				tab: {
					title: 'Example',
					icon: null,
					pinned: false,
					protected: false,
					unique: false,
					muted: false,
					title_matcher: null,
					url_matcher: null,
					group_id: null,
				},
			});
			await _pushToSync(config);

			// Simulate a fresh device/service-worker restart that never pushed
			// or pulled anything yet.
			delete localStore[LOCAL_SYNC_HASH_KEY];

			const result = await _pullFromSyncIfNewer();

			expect(result.status).toBe('updated');
			if (result.status === 'updated') {
				expect(result.data.rules).toHaveLength(1);
				expect(result.data.rules[0].id).toBe('remote-rule');
			}
			// Pulling should also remember the hash, so a follow-up push of the
			// same data doesn't ping-pong back to sync.
			expect(localStore[LOCAL_SYNC_HASH_KEY]).toBe(syncStore[STORAGE_KEY_METADATA].hash);
		});
	});
});
