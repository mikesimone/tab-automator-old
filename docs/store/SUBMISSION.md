# Tab Automator: Chrome Web Store submission

Everything below is ready to paste. Store images are in `docs/store/`; the zip comes from `npm run build-zip`.

## 1. Settings (the page you're on)
- **Contact email:** click *Add email* and verify it. This email is shown publicly on the listing, so consider an alias.
- **Trader declaration:** leave it on *non-trader*.
- **Address:** skip it unless the dashboard blocks submission. Non-trader addresses aren't displayed.
- Save.

## 2. Create the item
**Items → New item** → upload `tab-automator.zip`.

## 3. Store listing tab
- **Description:** paste all of `docs/store_description.md` from the repo. It's also copied at the bottom of this file.
- **Category:** Productivity → Tools (or Workflow & Planning)
- **Language:** English
- **Store icon:** `icon_128.png`
- **Screenshots:** `store_1_rules.png`, `store_2_backup_sync.png` (both 1280×800)
- **Small promo tile:** `store_promo_tile_440x280.png`
- **Homepage URL:** https://github.com/mikesimone/tab-automator
- **Support URL:** https://github.com/mikesimone/tab-automator/issues
- Leave the marquee tile and video empty.

## 4. Privacy tab
**Single purpose:**
> Tab Automator changes browser tabs automatically based on rules the user writes: renaming tabs, changing tab icons, grouping, pinning, muting and closing inactive tabs.

**Permission justifications:**
- **tabs:** Reads each tab's URL and title to match it against the user's rules, then renames, pins, mutes or closes the tab as the rule says.
- **tabGroups:** Puts matching tabs into the tab groups the user defines in their rules.
- **storage:** Saves the user's rules and settings locally, and optionally in browser sync when the user turns on Sync Across Devices.
- **contextMenus:** Adds right-click actions such as "Rename Tab", "Send to Tab Hive" and "Exclude from Tab Hive".
- **scripting:** Injects the content script into tabs that were already open when the extension was installed or updated, so rules apply to them without a reload.
- **sidePanel:** Shows the Tab Hive side panel, which lists auto-closed tabs so the user can restore them, and offers quick rule creation.
- **bookmarks:** Spot Search (Alt+Shift+E) lets the user search their bookmarks together with open tabs. Bookmarks are read only and never leave the browser.
- **alarms:** Runs the periodic check that closes tabs left inactive longer than the user's Tab Hive timeout.
- **downloads:** When the user turns on Auto-Backup, saves a copy of their configuration to the Downloads folder (`tab-automator.auto-backup.json`) after each change.
- **Host permission (http/https on all sites):** Rules can target any website the user chooses, so the content script has to run on any page to change its title and favicon. No page content is collected or sent anywhere.

**Remote code:** No, I am not using remote code.

**Data usage:** leave every data-type box *unchecked*. The extension makes no network requests and collects nothing. Then tick all three certifications (not sold to third parties, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** not required when no user data is collected. If the form insists, use https://github.com/mikesimone/tab-automator#readme.

## 5. Distribution tab
- **Payments:** Free
- **Visibility:** Public (or Unlisted if you'd like to try it privately first)
- **Regions:** All regions

## 6. Submit for review
Click **Submit for review**. Because of the broad host permissions, expect an in-depth review, which usually takes a few days. Send me the store link once it's live, and I'll add it to the README and the extension menu.
