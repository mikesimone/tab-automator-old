import { TabModifierSettings } from './types.ts';
import { debugLog } from './debugLog.ts';

/**
 * Fixed filename so every auto-backup overwrites the previous one instead of
 * piling up "tab-automator.auto-backup (1).json", "(2).json", etc. in Downloads.
 * Deliberately different from the manual "Export" filename (tab-automator.config.json)
 * so the two features never collide.
 */
export const AUTO_BACKUP_FILENAME = 'tab-automator.auto-backup.json';

function _toBase64Utf8(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Write a copy of the current config to Downloads, if auto-backup is enabled.
 *
 * Deliberately NOT debounced with setTimeout: this is called from
 * _setStorage(), which also runs inside the background service worker
 * (MV3), where a detached timer can simply never fire if the worker is
 * suspended before it elapses. Awaiting inline keeps this work inside the
 * same promise chain the caller already awaits, which keeps the worker
 * alive until it's done.
 */
export async function _autoBackupConfig(tabModifier: TabModifierSettings): Promise<void> {
	if (!tabModifier.settings?.auto_backup_enabled) {
		return;
	}

	if (typeof chrome === 'undefined' || !chrome.downloads?.download) {
		// No downloads API available (e.g. unit tests) - silently no-op.
		return;
	}

	try {
		const json = JSON.stringify(tabModifier, null, 4);
		const dataUrl = `data:application/json;base64,${_toBase64Utf8(json)}`;

		await chrome.downloads.download({
			url: dataUrl,
			filename: AUTO_BACKUP_FILENAME,
			saveAs: false,
			conflictAction: 'overwrite',
		});

		debugLog('[Tab Automator] Auto-backup written to Downloads/' + AUTO_BACKUP_FILENAME);
	} catch (error) {
		// Never let a backup failure block the actual config save.
		console.error('[Tab Automator] Auto-backup to Downloads failed:', error);
	}
}
