import { AUTO_REFRESH_PRESETS } from '../common/autoRefresh';

export const AUTO_REFRESH_MENU_PARENT = 'auto-refresh-parent';
export const AUTO_REFRESH_MENU_PRESET_PREFIX = 'auto-refresh-every-';
export const AUTO_REFRESH_MENU_PAUSE = 'auto-refresh-pause';
export const AUTO_REFRESH_MENU_RESUME = 'auto-refresh-resume';

/**
 * Service responsible for managing context menus
 * Single Responsibility: Handle all context menu operations
 */
export class ContextMenuService {
	/**
	 * Initialize all context menus
	 */
	initialize(): void {
		this.createRenameTabMenu();
		this.createMergeWindowsMenu();
		this.createSendToHiveMenu();
		this.createTabHiveRejectMenus();
		this.createAutoRefreshMenus();
	}

	/**
	 * Create the "Auto-refresh this tab" menu: preset intervals plus pause/resume
	 */
	private createAutoRefreshMenus(): void {
		chrome.contextMenus.create({
			id: AUTO_REFRESH_MENU_PARENT,
			title: '🔄 Auto-refresh this tab',
			contexts: ['all'],
		});

		for (const preset of AUTO_REFRESH_PRESETS) {
			chrome.contextMenus.create({
				id: `${AUTO_REFRESH_MENU_PRESET_PREFIX}${preset.seconds}`,
				parentId: AUTO_REFRESH_MENU_PARENT,
				title: `Every ${preset.label}`,
				contexts: ['all'],
			});
		}

		chrome.contextMenus.create({
			id: 'auto-refresh-separator',
			parentId: AUTO_REFRESH_MENU_PARENT,
			type: 'separator',
			contexts: ['all'],
		});

		chrome.contextMenus.create({
			id: AUTO_REFRESH_MENU_PAUSE,
			parentId: AUTO_REFRESH_MENU_PARENT,
			title: '⏸ Pause on this tab',
			contexts: ['all'],
		});

		chrome.contextMenus.create({
			id: AUTO_REFRESH_MENU_RESUME,
			parentId: AUTO_REFRESH_MENU_PARENT,
			title: '▶ Resume on this tab',
			contexts: ['all'],
		});
	}

	/**
	 * Create the "Rename Tab" context menu
	 */
	private createRenameTabMenu(): void {
		chrome.contextMenus.create({
			id: 'rename-tab',
			title: '✏️ Rename Tab',
			contexts: ['all'],
		});
	}

	/**
	 * Create the "Merge All Windows" context menu
	 */
	private createMergeWindowsMenu(): void {
		chrome.contextMenus.create({
			id: 'merge-windows',
			title: '🪟 Merge All Windows',
			contexts: ['all'],
		});
	}

	/**
	 * Create the "Send to Tab Hive" context menu
	 */
	private createSendToHiveMenu(): void {
		chrome.contextMenus.create({
			id: 'send-to-hive',
			title: '🍯 Send to Tab Hive',
			contexts: ['all'],
		});
	}

	/**
	 * Create Tab Hive reject list context menus
	 */
	private createTabHiveRejectMenus(): void {
		// Parent menu
		chrome.contextMenus.create({
			id: 'tab-hive-reject-parent',
			title: '🚫 Exclude from Tab Hive',
			contexts: ['all'],
		});

		// Child menu: Exclude domain
		chrome.contextMenus.create({
			id: 'tab-hive-reject-domain',
			parentId: 'tab-hive-reject-parent',
			title: '🌐 Exclude this domain',
			contexts: ['all'],
		});

		// Child menu: Exclude URL
		chrome.contextMenus.create({
			id: 'tab-hive-reject-url',
			parentId: 'tab-hive-reject-parent',
			title: '🔗 Exclude this URL',
			contexts: ['all'],
		});
	}
}
