export type ReleaseNote = {
	version: string;
	features: { emoji: string; title: string; description: string }[];
};

// Newest first. Add an entry here for every release that users should hear about.
export const RELEASES: ReleaseNote[] = [
	{
		version: '1.3.0',
		features: [
			{
				emoji: '🔄',
				title: 'Auto-refresh',
				description:
					"Reload tabs on a timer: every 30 seconds, 1 minute, 5 minutes, 1 hour, 1 day, or a custom interval. Set it in a rule's Auto-refresh section to cover every matching tab, or right-click any page and choose Auto-refresh this tab. It never reloads the tab you're looking at unless you ask it to, and it waits while a tab plays audio, while you've typed something into the page, or while you're offline. Tabs that auto-refresh show ↻ on the toolbar icon.",
			},
			{
				emoji: '⏸',
				title: 'Pause auto-refresh on one tab',
				description:
					'Right-click a page, then Auto-refresh this tab, then Pause on this tab. It stays paused until you resume it or close the tab, even if a rule covers it.',
			},
			{
				emoji: '✨',
				title: "What's new",
				description: 'This page. It lists what changed in each version.',
			},
		],
	},
	{
		version: '1.2.0',
		features: [
			{
				emoji: '💾',
				title: 'Auto-backup',
				description:
					'Settings → Auto-Backup on Every Change saves a copy of your whole configuration to your Downloads folder whenever you change something.',
			},
			{
				emoji: '☁️',
				title: 'Sync across devices',
				description:
					'Settings → Sync Across Devices keeps your rules and groups the same on every computer signed in to your browser account.',
			},
		],
	},
];

const SEEN_VERSION_KEY = 'whats_new_seen_version';

export async function _hasUnseenWhatsNew(): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get(SEEN_VERSION_KEY);
		return result[SEEN_VERSION_KEY] !== RELEASES[0].version;
	} catch {
		return false;
	}
}

export async function _markWhatsNewSeen(): Promise<void> {
	try {
		await chrome.storage.local.set({ [SEEN_VERSION_KEY]: RELEASES[0].version });
	} catch {
		// Not being able to remember this only means the "new!" badge shows again.
	}
}

export const WHATS_NEW_HASH = '#whats-new';

/**
 * After an update, open the Options page on What's new, once per release
 * that has notes. Silent updates with no new notes don't open anything.
 */
export async function _openWhatsNewAfterUpdate(previousVersion: string | undefined): Promise<void> {
	const latest = RELEASES[0].version;

	if (previousVersion === latest || !(await _hasUnseenWhatsNew())) {
		return;
	}

	await chrome.tabs.create({
		url: chrome.runtime.getURL(`src/options.html${WHATS_NEW_HASH}`),
	});
}
