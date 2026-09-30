import { TabModifierSettings } from './types.ts';
import { debugLog } from './debugLog.ts';
import {
	_compressData,
	_loadFromStorage,
	STORAGE_KEY_CHUNK_PREFIX,
	STORAGE_KEY_METADATA,
} from './storage.ts';

/**
 * Key in chrome.storage.local (not sync!) remembering the hash of the last
 * config we either pushed to sync or pulled from sync. Used purely to tell
 * "this onChanged/sync event is an echo of our own write" apart from "this
 * is a genuine change from another device" - without it, pushing to sync
 * would immediately trigger our own onChanged listener, which would pull it
 * right back down, forever.
 *
 * Deliberately kept in storage rather than a module variable: MV3 service
 * workers are killed and restarted frequently, and an in-memory variable
 * would not survive that.
 */
export const LOCAL_SYNC_HASH_KEY = 'tab_modifier_sync_hash';

/**
 * Conservative per-chunk character budget. compressToUTF16's output can use
 * the full UTF-16 code unit range, which can cost up to 3 bytes/char once
 * UTF-8 encoded for chrome.storage's quota accounting - so we budget for the
 * worst case rather than the common case, to comfortably clear the 8KB
 * per-item sync quota with room for JSON/key overhead.
 */
const SYNC_CHUNK_CHAR_LIMIT = 2000;

const DEFAULT_SYNC_QUOTA_BYTES = 102400; // chrome.storage.sync.QUOTA_BYTES
const DEFAULT_SYNC_MAX_ITEMS = 512; // chrome.storage.sync.MAX_ITEMS

export type SyncPushResult = 'ok' | 'disabled' | 'unchanged' | 'too-large' | 'unavailable';
export type SyncPullResult =
	| { status: 'updated'; data: TabModifierSettings }
	| { status: 'unchanged' | 'no-data' | 'unavailable' };

function _chunkString(str: string, size: number): string[] {
	if (str.length === 0) {
		return [''];
	}

	const chunks: string[] = [];
	for (let i = 0; i < str.length; i += size) {
		chunks.push(str.slice(i, i + size));
	}
	return chunks;
}

async function _hashString(str: string): Promise<string> {
	const bytes = new TextEncoder().encode(str);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function _storageGet(
	storage: chrome.storage.StorageArea,
	keys: string[]
): Promise<Record<string, any>> {
	return new Promise((resolve, reject) => {
		storage.get(keys, (items) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve(items || {});
			}
		});
	});
}

function _storageSet(
	storage: chrome.storage.StorageArea,
	items: Record<string, any>
): Promise<void> {
	return new Promise((resolve, reject) => {
		storage.set(items, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve();
			}
		});
	});
}

function _storageRemove(storage: chrome.storage.StorageArea, keys: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		storage.remove(keys, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve();
			}
		});
	});
}

function _isSyncAvailable(): boolean {
	return typeof chrome !== 'undefined' && !!chrome.storage?.sync && !!crypto?.subtle;
}

/**
 * Mirror the given config to chrome.storage.sync, so it becomes available
 * to the user's other devices signed into the same browser account.
 *
 * One-way by itself (local -> sync); see _pullFromSyncIfNewer() for the
 * other direction. Deliberately NOT debounced with setTimeout - this is
 * called from _setStorage(), including from within the background service
 * worker, where a detached timer may simply never fire before the worker
 * is suspended. Awaiting inline keeps it in the same promise chain the
 * caller already awaits.
 */
export async function _pushToSync(tabModifier: TabModifierSettings): Promise<SyncPushResult> {
	if (!tabModifier.settings?.sync_enabled) {
		return 'disabled';
	}

	if (!_isSyncAvailable()) {
		return 'unavailable';
	}

	try {
		const data = {
			rules: tabModifier.rules,
			groups: tabModifier.groups,
			settings: tabModifier.settings,
		};
		const compressed = _compressData(data);
		const hash = await _hashString(compressed);

		const { [LOCAL_SYNC_HASH_KEY]: lastHash } = await _storageGet(chrome.storage.local, [
			LOCAL_SYNC_HASH_KEY,
		]);

		if (lastHash === hash) {
			return 'unchanged';
		}

		const chunks = _chunkString(compressed, SYNC_CHUNK_CHAR_LIMIT);

		// Worst-case UTF-8 byte estimate for a UTF-16 string; see
		// SYNC_CHUNK_CHAR_LIMIT above for why 3 bytes/char.
		const estimatedBytes = compressed.length * 3;
		const quotaBytes = chrome.storage.sync.QUOTA_BYTES ?? DEFAULT_SYNC_QUOTA_BYTES;
		const maxItems = chrome.storage.sync.MAX_ITEMS ?? DEFAULT_SYNC_MAX_ITEMS;

		// Leave headroom below the hard quota for key-name overhead and the
		// metadata item itself.
		if (estimatedBytes > quotaBytes * 0.9 || chunks.length + 1 > maxItems) {
			console.warn(
				`[Tab Automator] Config too large to sync (~${estimatedBytes} bytes, limit ~${quotaBytes}). ` +
					'Falling back to local storage only.'
			);
			return 'too-large';
		}

		const existingMeta = await _storageGet(chrome.storage.sync, [STORAGE_KEY_METADATA]);
		const previousChunkCount: number = existingMeta[STORAGE_KEY_METADATA]?.chunkCount ?? 0;

		const items: Record<string, any> = {
			[STORAGE_KEY_METADATA]: {
				chunkCount: chunks.length,
				hash,
				updatedAt: Date.now(),
			},
		};
		chunks.forEach((chunk, i) => {
			items[`${STORAGE_KEY_CHUNK_PREFIX}${i}`] = chunk;
		});

		await _storageSet(chrome.storage.sync, items);

		if (previousChunkCount > chunks.length) {
			const staleKeys = Array.from(
				{ length: previousChunkCount - chunks.length },
				(_, i) => `${STORAGE_KEY_CHUNK_PREFIX}${chunks.length + i}`
			);
			await _storageRemove(chrome.storage.sync, staleKeys);
		}

		await _storageSet(chrome.storage.local, { [LOCAL_SYNC_HASH_KEY]: hash });

		debugLog(
			`[Tab Automator] Pushed config to sync (${chunks.length} chunk(s), hash ${hash.slice(0, 8)})`
		);

		return 'ok';
	} catch (error) {
		console.error('[Tab Automator] Failed to push config to sync:', error);
		return 'unavailable';
	}
}

/**
 * Check whether chrome.storage.sync holds a config newer than what we last
 * pushed/pulled, and if so, return it decompressed and ready to apply
 * locally. Safe to call speculatively (e.g. from a storage.onChanged
 * listener, or a manual "Sync Now" button) - it's a cheap metadata read in
 * the common "nothing changed" case.
 */
export async function _pullFromSyncIfNewer(): Promise<SyncPullResult> {
	if (!_isSyncAvailable()) {
		return { status: 'unavailable' };
	}

	try {
		const metaResult = await _storageGet(chrome.storage.sync, [STORAGE_KEY_METADATA]);
		const remoteMeta = metaResult[STORAGE_KEY_METADATA];

		if (!remoteMeta) {
			return { status: 'no-data' };
		}

		const { [LOCAL_SYNC_HASH_KEY]: lastHash } = await _storageGet(chrome.storage.local, [
			LOCAL_SYNC_HASH_KEY,
		]);

		if (remoteMeta.hash && remoteMeta.hash === lastHash) {
			return { status: 'unchanged' };
		}

		const data = await _loadFromStorage(chrome.storage.sync, 'sync');

		if (!data) {
			return { status: 'no-data' };
		}

		// Remember this hash *before* the caller re-saves it locally (which
		// will in turn call _pushToSync again) - otherwise that follow-up
		// push would see a stale lastHash and write straight back to sync,
		// which is harmless but pointless.
		if (remoteMeta.hash) {
			await _storageSet(chrome.storage.local, { [LOCAL_SYNC_HASH_KEY]: remoteMeta.hash });
		}

		debugLog('[Tab Automator] Pulled newer config from sync');

		return { status: 'updated', data };
	} catch (error) {
		console.error('[Tab Automator] Failed to pull config from sync:', error);
		return { status: 'unavailable' };
	}
}
