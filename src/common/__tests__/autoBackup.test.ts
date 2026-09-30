import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _autoBackupConfig, AUTO_BACKUP_FILENAME } from '../autoBackup';
import { TabModifierSettings } from '../types';

function makeConfig(autoBackupEnabled: boolean): TabModifierSettings {
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
			auto_backup_enabled: autoBackupEnabled,
			sync_enabled: false,
		},
	};
}

describe('autoBackup', () => {
	beforeEach(() => {
		// @ts-expect-error - global is from vitest setup
		global.chrome = {
			downloads: {
				download: vi.fn((_options: any, callback?: (id: number) => void) => {
					callback?.(1);
					return Promise.resolve(1);
				}),
			},
		};
	});

	it('does nothing when auto-backup is disabled', async () => {
		await _autoBackupConfig(makeConfig(false));

		// @ts-expect-error - global is untyped in this project (no @types/node)
		expect(global.chrome.downloads.download).not.toHaveBeenCalled();
	});

	it('does nothing when chrome.downloads is unavailable', async () => {
		// @ts-expect-error - global is untyped in this project (no @types/node)
		global.chrome = {};

		await expect(_autoBackupConfig(makeConfig(true))).resolves.not.toThrow();
	});

	it('downloads a JSON backup with a fixed, overwritable filename', async () => {
		await _autoBackupConfig(makeConfig(true));

		// @ts-expect-error - global is untyped in this project (no @types/node)
		expect(global.chrome.downloads.download).toHaveBeenCalledTimes(1);
		// @ts-expect-error - global is untyped in this project (no @types/node)
		const [options] = global.chrome.downloads.download.mock.calls[0];

		expect(options.filename).toBe(AUTO_BACKUP_FILENAME);
		expect(options.conflictAction).toBe('overwrite');
		expect(options.saveAs).toBe(false);
		expect(options.url).toMatch(/^data:application\/json;base64,/);

		const base64 = options.url.split(',')[1];
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const decoded = JSON.parse(new TextDecoder().decode(bytes));
		expect(decoded.settings.auto_backup_enabled).toBe(true);
	});

	it('swallows errors from the downloads API instead of throwing', async () => {
		// @ts-expect-error - global is untyped in this project (no @types/node)
		global.chrome.downloads.download = vi.fn(() => {
			throw new Error('boom');
		});

		await expect(_autoBackupConfig(makeConfig(true))).resolves.not.toThrow();
	});
});
