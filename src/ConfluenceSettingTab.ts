import { App, Setting, PluginSettingTab, Notice } from "obsidian";
import ConfluencePlugin from "./main";

export class ConfluenceSettingTab extends PluginSettingTab {
	plugin: ConfluencePlugin;

	constructor(app: App, plugin: ConfluencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Confluence Settings",
		});

		new Setting(containerEl)
			.setName("Confluence Domain")
			.setDesc('Confluence Domain eg "https://mysite.atlassian.net"')
			.addText((text) =>
				text
					.setPlaceholder("https://mysite.atlassian.net")
					.setValue(this.plugin.settings.confluenceBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.confluenceBaseUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Atlassian Username")
			.setDesc('eg "username@domain.com"')
			.addText((text) =>
				text
					.setPlaceholder("username@domain.com")
					.setValue(this.plugin.settings.atlassianUserName)
					.onChange(async (value) => {
						this.plugin.settings.atlassianUserName = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Atlassian API Token")
			.setDesc("")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.atlassianApiToken)
					.onChange(async (value) => {
						this.plugin.settings.atlassianApiToken = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Confluence Parent Page ID")
			.setDesc("Page ID to publish files under")
			.addText((text) =>
				text
					.setPlaceholder("23232345645")
					.setValue(this.plugin.settings.confluenceParentId)
					.onChange(async (value) => {
						this.plugin.settings.confluenceParentId = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Folder to publish (optional)")
			.setDesc(
				"Limit publishing to a specific vault folder; leave blank to include every note and use frontmatter toggles instead.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. Projects/Documentation")
					.setValue(this.plugin.settings.folderToPublish)
					.onChange(async (value) => {
						this.plugin.settings.folderToPublish = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Required backlink key")
			.setDesc(
				"Only notes containing this wiki-link (e.g. [[atlassian]]) will publish. Leave blank to disable the filter.",
			)
			.addText((text) =>
				text
					.setPlaceholder("[[atlassian]]")
					.setValue(this.plugin.settings.keyBacklink ?? "")
					.onChange(async (value) => {
						this.plugin.settings.keyBacklink = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("First Header Page Name")
			.setDesc("First header replaces file name as page title")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.firstHeadingPageTitle)
					.onChange(async (value) => {
						this.plugin.settings.firstHeadingPageTitle = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Mermaid Diagram Theme")
			.setDesc("Pick the theme to apply to mermaid diagrams")
			.addDropdown((dropdown) => {
				/* eslint-disable @typescript-eslint/naming-convention */
				dropdown
					.addOptions({
						"match-obsidian": "Match Obsidian",
						"light-obsidian": "Obsidian Theme - Light",
						"dark-obsidian": "Obsidian Theme - Dark",
						default: "Mermaid - Default",
						neutral: "Mermaid - Neutral",
						dark: "Mermaid - Dark",
						forest: "Mermaid - Forest",
					})
					.setValue(this.plugin.settings.mermaidTheme)
					.onChange(async (value) => {
						// @ts-expect-error
					this.plugin.settings.mermaidTheme = value;
					await this.plugin.saveSettings();
				});
			/* eslint-enable @typescript-eslint/naming-convention */
		});


		containerEl.createEl("h3", { text: "Automation" });
		containerEl.createEl("p", {
			text: "Keep Confluence in sync while respecting Atlassian API limits.",
			cls: "setting-item-description",
		});

		let liveSyncModeSetting: Setting;
		let liveSyncDelaySetting: Setting;
		let liveSyncIntervalSetting: Setting;
		let cleanupSetting: Setting;

		const refreshAutomationControls = () => {
			const enabled = this.plugin.settings.liveSyncEnabled;
			const strategy = this.plugin.settings.liveSyncStrategy ?? "on-save";
			const usesOnSave = strategy === "on-save" || strategy === "both";
			const usesInterval = strategy === "interval" || strategy === "both";
			liveSyncModeSetting.setDisabled(!enabled);
			liveSyncDelaySetting.setDisabled(!enabled || !usesOnSave);
			liveSyncIntervalSetting.setDisabled(!enabled || !usesInterval);
		};

		new Setting(containerEl)
			.setName("Live sync")
			.setDesc(
				"Automatically publish qualifying notes after you save or on a schedule.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.liveSyncEnabled)
					.onChange(async (value) => {
						this.plugin.settings.liveSyncEnabled = value;
						refreshAutomationControls();
						await this.plugin.saveSettings();
					}),
			);

		liveSyncModeSetting = new Setting(containerEl)
			.setName("Sync trigger")
			.setDesc("Choose when automatic publishes run.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"on-save": "When I save",
						"interval": "On a schedule",
						"both": "Save + schedule",
					})
					.setValue(this.plugin.settings.liveSyncStrategy)
					.onChange(async (value) => {
						this.plugin.settings.liveSyncStrategy = value as
							| "on-save"
							| "interval"
							| "both";
						refreshAutomationControls();
						await this.plugin.saveSettings();
					}));

		liveSyncDelaySetting = new Setting(containerEl)
			.setName("Save debounce")
			.setDesc("Seconds to wait after the final save before publishing.")
			.addSlider((slider) =>
				slider
					.setLimits(2, 60, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.liveSyncDebounceSeconds)
					.onChange(async (value) => {
						this.plugin.settings.liveSyncDebounceSeconds = value;
						await this.plugin.saveSettings();
					}));

		liveSyncIntervalSetting = new Setting(containerEl)
			.setName("Scheduled sync interval")
			.setDesc("Minutes between background syncs. Longer intervals reduce Atlassian API usage.")
			.addSlider((slider) =>
				slider
					.setLimits(5, 240, 5)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.liveSyncIntervalMinutes)
					.onChange(async (value) => {
						this.plugin.settings.liveSyncIntervalMinutes = value;
						await this.plugin.saveSettings();
					}));

		cleanupSetting = new Setting(containerEl)
			.setName("Orphan cleanup cadence")
			.setDesc("Hours between automatic removal of Confluence pages whose source files disappeared.")
			.addSlider((slider) =>
				slider
					.setLimits(6, 72, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.orphanCleanupIntervalHours)
					.onChange(async (value) => {
						this.plugin.settings.orphanCleanupIntervalHours = value;
						await this.plugin.saveSettings();
					}))
			.addExtraButton((button) =>
				button
					.setIcon("reset")
					.setTooltip("Immediately remove orphaned Confluence pages")
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.runOrphanCleanupNow();
						new Notice("Orphan cleanup completed.");
						button.setDisabled(false);
					}));

		refreshAutomationControls();
	}
}
