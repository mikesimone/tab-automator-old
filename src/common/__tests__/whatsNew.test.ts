import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES, _openWhatsNewAfterUpdate } from '../whatsNew';

const store: Record<string, unknown> = {};
(globalThis as any).chrome = {
	storage: {
		local: {
			get: vi.fn(async (key: string) => ({ [key]: store[key] })),
			set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
		},
	},
	tabs: { create: vi.fn() },
	runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
};

describe('_openWhatsNewAfterUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(store)) delete store[key];
	});

	it("opens What's new after updating from an older version", async () => {
		await _openWhatsNewAfterUpdate('1.2.0');
		expect((globalThis as any).chrome.tabs.create).toHaveBeenCalledWith({
			url: 'chrome-extension://id/src/options.html#whats-new',
		});
	});

	it('stays quiet when the notes were already seen or nothing changed', async () => {
		await _openWhatsNewAfterUpdate(RELEASES[0].version);
		store.whats_new_seen_version = RELEASES[0].version;
		await _openWhatsNewAfterUpdate('1.2.0');
		expect((globalThis as any).chrome.tabs.create).not.toHaveBeenCalled();
	});
});
