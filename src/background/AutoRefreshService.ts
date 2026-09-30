import { _findRuleForUrl, _getStorageAsync, _isUrlSkippedBySettings } from '../common/storage';
import {
	AUTO_REFRESH_ALARM_PREFIX,
	AUTO_REFRESH_RETRY_SECONDS,
	AutoRefreshTabOverride,
	AutoRefreshTabOverrides,
	_getAutoRefreshAlarmName,
	_getAutoRefreshBlocker,
	_getTabIdFromAutoRefreshAlarm,
	_makeAdhocOverride,
	_resolveTabAutoRefresh,
} from '../common/autoRefresh';
import { AutoRefresh, TabModifierSettings } from '../common/types';

type ConfigLoader = () => Promise<TabModifierSettings | undefined>;

const OVERRIDES_KEY = 'auto_refresh_tab_overrides';
const BADGE_ON = '↻';
const BADGE_PAUSED = '⏸';

/**
 * Reloads tabs whose rule has auto-refresh turned on, or that were set to
 * auto-refresh from the right-click menu.
 *
 * Each tab gets its own chrome.alarms alarm, because service worker timers
 * stop when the worker is suspended. The alarm is reset every time the page
 * finishes loading, so the interval always counts from the last load.
 */
export class AutoRefreshService {
	constructor(
		private readonly loadConfig: ConfigLoader = _getStorageAsync,
		private readonly isOnline: () => boolean = () => navigator.onLine !== false
	) {}

	/**
	 * Called from tabs.onUpdated for every update.
	 */
	async onTabUpdated(tab: chrome.tabs.Tab, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
		if (tab.id === undefined || !tab.url) return;
		if (!changeInfo.url && changeInfo.status !== 'complete') return;

		const overrides = await this.getOverrides();
		const override = overrides[tab.id];

		// A menu-started refresh stops once the tab moves to another site.
		if (override?.adhoc && !_resolveTabAutoRefresh(undefined, override, tab.url)) {
			delete override.adhoc;
			await this.setOverride(tab.id, override);
		}

		const settings = this.resolve(await this.loadConfig(), override, tab.url);

		if (!settings) {
			await this.stop(tab.id, !!override?.paused);
			return;
		}

		if (changeInfo.status === 'complete') {
			await this.start(tab.id, settings.interval_seconds);
		}
	}

	/**
	 * Right-click menu: refresh this tab every `intervalSeconds`.
	 */
	async startForTab(tab: chrome.tabs.Tab, intervalSeconds: number): Promise<void> {
		if (tab.id === undefined || !tab.url) return;

		const override = _makeAdhocOverride(tab.url, intervalSeconds);
		await this.setOverride(tab.id, override);
		await this.start(tab.id, override.adhoc!.interval_seconds);
	}

	/**
	 * Right-click menu: stop refreshing this tab until resumed or closed.
	 */
	async pauseTab(tabId: number): Promise<void> {
		const override = (await this.getOverrides())[tabId] ?? {};
		override.paused = true;
		await this.setOverride(tabId, override);
		await this.stop(tabId, true);
	}

	/**
	 * Right-click menu: undo a pause and pick the timer back up.
	 */
	async resumeTab(tab: chrome.tabs.Tab): Promise<void> {
		if (tab.id === undefined || !tab.url) return;

		const override = (await this.getOverrides())[tab.id] ?? {};
		delete override.paused;
		await this.setOverride(tab.id, override);

		const settings = this.resolve(await this.loadConfig(), override, tab.url);
		if (settings) {
			await this.start(tab.id, settings.interval_seconds);
		} else {
			await this.stop(tab.id, false);
		}
	}

	async onTabRemoved(tabId: number): Promise<void> {
		await chrome.alarms.clear(_getAutoRefreshAlarmName(tabId));
		await this.setOverride(tabId, undefined);
	}

	/**
	 * Brings alarms in line with the current rules: adds alarms for tabs that
	 * now need one and removes the rest. Existing alarms keep their timing
	 * unless the rule's interval got shorter than the time left.
	 */
	async syncAllTabs(): Promise<void> {
		const config = await this.loadConfig();
		const overrides = await this.getOverrides();
		const alarms = await chrome.alarms.getAll();
		const alarmsByTab = new Map<number, chrome.alarms.Alarm>();

		for (const alarm of alarms) {
			const tabId = _getTabIdFromAutoRefreshAlarm(alarm.name);
			if (tabId !== null) alarmsByTab.set(tabId, alarm);
		}

		const anyRuleRefreshes = !!config?.rules?.some((rule) => rule.tab?.auto_refresh?.enabled);
		const anyOverrides = Object.keys(overrides).length > 0;

		// Common case: nobody uses auto-refresh, so skip looking at every tab.
		if (!anyRuleRefreshes && !anyOverrides && alarmsByTab.size === 0) return;

		const tabs = await chrome.tabs.query({});
		const openTabIds = new Set<number>();
		const wanted = new Set<number>();

		for (const tab of tabs) {
			if (tab.id === undefined || !tab.url) continue;
			openTabIds.add(tab.id);

			const settings = this.resolve(config, overrides[tab.id], tab.url);
			if (!settings) continue;

			wanted.add(tab.id);

			const existing = alarmsByTab.get(tab.id);
			const maxDelayMs = settings.interval_seconds * 1000;

			if (!existing || existing.scheduledTime - Date.now() > maxDelayMs) {
				await this.start(tab.id, settings.interval_seconds);
			} else {
				await this.setBadge(tab.id, BADGE_ON);
			}
		}

		for (const tabId of alarmsByTab.keys()) {
			if (!wanted.has(tabId)) await this.stop(tabId, !!overrides[tabId]?.paused);
		}

		// Forget choices for tabs that closed while the worker was asleep.
		for (const tabId of Object.keys(overrides).map(Number)) {
			if (!openTabIds.has(tabId)) await this.setOverride(tabId, undefined);
		}
	}

	isAutoRefreshAlarm(alarm: chrome.alarms.Alarm): boolean {
		return alarm.name.startsWith(AUTO_REFRESH_ALARM_PREFIX);
	}

	async handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
		const tabId = _getTabIdFromAutoRefreshAlarm(alarm.name);
		if (tabId === null) return;

		let tab: chrome.tabs.Tab;
		try {
			tab = await chrome.tabs.get(tabId);
		} catch {
			// Tab is gone; the alarm was one-shot, so only the menu choice is left.
			await this.setOverride(tabId, undefined);
			return;
		}

		if (!tab.url) return;

		// Re-check: the rule or the menu choice may have changed since scheduling.
		const overrides = await this.getOverrides();
		const settings = this.resolve(await this.loadConfig(), overrides[tabId], tab.url);
		if (!settings) return;

		const blocker = await this.getBlocker(tab, settings);

		if (blocker) {
			console.log(`[Tab Automator] 🔄 Auto-refresh of tab ${tabId} postponed: ${blocker}`);
			await this.schedule(tabId, AUTO_REFRESH_RETRY_SECONDS);
			return;
		}

		console.log(`[Tab Automator] 🔄 Auto-refreshing tab ${tabId}`);
		// The next alarm is scheduled from onUpdated once the reload completes.
		await chrome.tabs.reload(tabId, { bypassCache: settings.bypass_cache });
	}

	private resolve(
		config: TabModifierSettings | undefined,
		override: AutoRefreshTabOverride | undefined,
		url: string
	): AutoRefresh | null {
		if (config?.settings && _isUrlSkippedBySettings(config.settings, url)) return null;

		const rule = config?.rules ? _findRuleForUrl(config.rules, url) : undefined;

		return _resolveTabAutoRefresh(rule, override, url);
	}

	private async start(tabId: number, delaySeconds: number): Promise<void> {
		await this.schedule(tabId, delaySeconds);
		await this.setBadge(tabId, BADGE_ON);
	}

	private async stop(tabId: number, paused: boolean): Promise<void> {
		await chrome.alarms.clear(_getAutoRefreshAlarmName(tabId));
		await this.setBadge(tabId, paused ? BADGE_PAUSED : '');
	}

	private async schedule(tabId: number, delaySeconds: number): Promise<void> {
		await chrome.alarms.create(_getAutoRefreshAlarmName(tabId), {
			delayInMinutes: delaySeconds / 60,
		});
	}

	private async setBadge(tabId: number, text: string): Promise<void> {
		try {
			await chrome.action.setBadgeText({ tabId, text });
			if (text) {
				await chrome.action.setBadgeBackgroundColor({ tabId, color: '#7c3aed' });
			}
		} catch {
			// The tab may have closed in the meantime; the badge doesn't matter then.
		}
	}

	private async getOverrides(): Promise<AutoRefreshTabOverrides> {
		try {
			const result = await chrome.storage.session.get(OVERRIDES_KEY);
			return (result?.[OVERRIDES_KEY] as AutoRefreshTabOverrides) ?? {};
		} catch {
			return {};
		}
	}

	private async setOverride(
		tabId: number,
		override: AutoRefreshTabOverride | undefined
	): Promise<void> {
		const overrides = await this.getOverrides();
		const isEmpty = !override || (!override.paused && !override.adhoc);

		if (isEmpty) {
			if (!(tabId in overrides)) return;
			delete overrides[tabId];
		} else {
			overrides[tabId] = override;
		}

		await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
	}

	private async getBlocker(tab: chrome.tabs.Tab, settings: AutoRefresh): Promise<string | null> {
		let windowFocused = false;
		if (settings.only_when_window_unfocused) {
			try {
				windowFocused = (await chrome.windows.get(tab.windowId)).focused;
			} catch {
				windowFocused = false;
			}
		}

		const editing = settings.skip_if_editing ? await this.hasUnsavedInput(tab.id!) : false;

		return _getAutoRefreshBlocker(settings, {
			offline: !this.isOnline(),
			tabActive: !!tab.active,
			windowFocused,
			audible: !!tab.audible,
			discarded: !!tab.discarded,
			loading: tab.status === 'loading',
			editing,
		});
	}

	/**
	 * Asks the page's content script whether the user typed something that a
	 * reload would throw away. Pages without the content script count as clean.
	 */
	private async hasUnsavedInput(tabId: number): Promise<boolean> {
		try {
			const response = await chrome.tabs.sendMessage(tabId, { action: 'autoRefreshCheck' });
			return response?.editing === true;
		} catch {
			return false;
		}
	}
}
