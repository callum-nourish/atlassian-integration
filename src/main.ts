import {
	Plugin,
	Notice,
	MarkdownView,
	Workspace,
	loadMermaid,
	TAbstractFile,
	TFile,
} from "obsidian";
import SparkMD5 from "spark-md5";
import {
	ConfluenceUploadSettings,
	Publisher,
	ConfluencePageConfig,
	StaticSettingsLoader,
	renderADFDoc,
	MermaidRendererPlugin,
	UploadAdfFileResult,
} from "@markdown-confluence/lib";
import { ElectronMermaidRenderer } from "@markdown-confluence/mermaid-electron-renderer";
import { ConfluenceSettingTab } from "./ConfluenceSettingTab";
import ObsidianAdaptor from "./adaptors/obsidian";
import { CompletedModal } from "./CompletedModal";
import { ObsidianConfluenceClient, HTTPError } from "./MyBaseClient";
import {
	ConfluencePerPageForm,
	ConfluencePerPageUIValues,
	mapFrontmatterToConfluencePerPageUIValues,
} from "./ConfluencePerPageForm";
import { Mermaid } from "mermaid";
import { normalizeBacklinkKey } from "./backlinkUtils";

export interface ObsidianPluginSettings
	extends ConfluenceUploadSettings.ConfluenceSettings {
	mermaidTheme:
		| "match-obsidian"
		| "light-obsidian"
		| "dark-obsidian"
		| "default"
		| "neutral"
		| "dark"
		| "forest";
	keyBacklink: string;
	backlinkPublishState: Record<string, string>;
	liveSyncEnabled: boolean;
	liveSyncDebounceSeconds: number;
	liveSyncStrategy: "on-save" | "interval" | "both";
	liveSyncIntervalMinutes: number;
	orphanCleanupIntervalHours: number;
	lastOrphanCleanupTs?: number;
	liveSyncHashes: Record<string, string>;
}

interface FailedFile {
	fileName: string;
	reason: string;
}

interface UploadResults {
	errorMessage: string | null;
	failedFiles: FailedFile[];
	filesUploadResult: UploadAdfFileResult[];
}

type PublisherResult = Awaited<ReturnType<Publisher["publish"]>>;

interface BacklinkCleanupStats {
	deletedPaths: string[];
	failedDeletions: { path: string; reason: string }[];
}

export default class ConfluencePlugin extends Plugin {
	settings!: ObsidianPluginSettings;
	private isSyncing = false;
	private liveSyncQueue = new Set<string>();
	private liveSyncTimeout: number | null = null;
	private liveSyncListenerRegistered = false;
	private liveSyncIntervalId: number | null = null;
	private statusBarEl: HTMLElement | null = null;
	workspace!: Workspace;
	publisher!: Publisher;
	adaptor!: ObsidianAdaptor;
	private confluenceClient!: ObsidianConfluenceClient;

	activeLeafPath(workspace: Workspace) {
		return workspace.getActiveViewOfType(MarkdownView)?.file?.path;
	}

	async init() {
		await this.loadSettings();
		const { vault, metadataCache, workspace } = this.app;
		this.workspace = workspace;
		this.adaptor = new ObsidianAdaptor(
			vault,
			metadataCache,
			this.settings,
			this.app,
		);

		const mermaidItems = await this.getMermaidItems();
		const mermaidRenderer = new ElectronMermaidRenderer(
			mermaidItems.extraStyleSheets,
			mermaidItems.extraStyles,
			mermaidItems.mermaidConfig,
			mermaidItems.bodyStyles,
		);
		this.confluenceClient = new ObsidianConfluenceClient({
			host: this.settings.confluenceBaseUrl,
			authentication: {
				basic: {
					email: this.settings.atlassianUserName,
					apiToken: this.settings.atlassianApiToken,
				},
			},
			middlewares: {
				onError(e) {
					const response = (e as { response?: { data?: unknown } }).response;
					if (response && "data" in response) {
						const data = response.data;
						e.message =
							typeof data === "string" ? data : JSON.stringify(data);
					}
				},
			},
		});

		const settingsLoader = new StaticSettingsLoader(this.settings);
		this.publisher = new Publisher(
			this.adaptor,
			settingsLoader,
			this.confluenceClient,
			[new MermaidRendererPlugin(mermaidRenderer)],
		);

		this.ensureLiveSyncListener();
		this.syncLiveSyncRuntimeState();
		void this.maybeRunOrphanCleanup();
	}

	async getMermaidItems() {
		const extraStyles: string[] = [];
		const extraStyleSheets: string[] = [];
		let bodyStyles = "";
		const body = document.querySelector("body") as HTMLBodyElement;

		switch (this.settings.mermaidTheme) {
			case "default":
			case "neutral":
			case "dark":
			case "forest":
				return {
					extraStyleSheets,
					extraStyles,
					mermaidConfig: { theme: this.settings.mermaidTheme },
					bodyStyles,
				};
			case "match-obsidian":
				bodyStyles = body.className;
				break;
			case "dark-obsidian":
				bodyStyles = "theme-dark";
				break;
			case "light-obsidian":
				bodyStyles = "theme-dark";
				break;
			default:
				throw new Error("Missing theme");
		}

		extraStyleSheets.push("app://obsidian.md/app.css");

		// @ts-expect-error
		const cssTheme = this.app.vault?.getConfig("cssTheme") as string;
		if (cssTheme) {
			const fileExists = await this.app.vault.adapter.exists(
				`.obsidian/themes/${cssTheme}/theme.css`,
			);
			if (fileExists) {
				const themeCss = await this.app.vault.adapter.read(
					`.obsidian/themes/${cssTheme}/theme.css`,
				);
				extraStyles.push(themeCss);
			}
		}

		const cssSnippets =
			// @ts-expect-error
			(this.app.vault?.getConfig("enabledCssSnippets") as string[]) ?? [];
		for (const snippet of cssSnippets) {
			const fileExists = await this.app.vault.adapter.exists(
				`.obsidian/snippets/${snippet}.css`,
			);
			if (fileExists) {
				const themeCss = await this.app.vault.adapter.read(
					`.obsidian/snippets/${snippet}.css`,
				);
				extraStyles.push(themeCss);
			}
		}

		return {
			extraStyleSheets,
			extraStyles,
			mermaidConfig: (
				(await loadMermaid()) as Mermaid
			).mermaidAPI.getConfig(),
			bodyStyles,
		};
	}

	async doPublish(
		publishFilter?: string,
		options?: { skipCleanup?: boolean },
	): Promise<UploadResults> {
		const adrFiles = await this.publisher.publish(publishFilter);

		const shouldCleanup = !(
			options?.skipCleanup ?? Boolean(publishFilter)
		);
		if (shouldCleanup) {
			const eligiblePaths = new Set(
				adrFiles.map((fileResult) => fileResult.node.file.absoluteFilePath),
			);
			const cleanupStats = await this.removeBacklinkOrphans(eligiblePaths);
			this.notifyBacklinkCleanup(cleanupStats);
		}
		await this.updateBacklinkState(adrFiles);

		const returnVal: UploadResults = {
			errorMessage: null,
			failedFiles: [],
			filesUploadResult: [],
		};

		adrFiles.forEach((element) => {
			if (element.successfulUploadResult) {
				returnVal.filesUploadResult.push(
					element.successfulUploadResult,
				);
				return;
			}

			returnVal.failedFiles.push({
				fileName: element.node.file.absoluteFilePath,
				reason: element.reason ?? "No Reason Provided",
			});
		});

		return returnVal;
	}

	override async onload() {
		await this.init();
		this.setupStatusBar();

		this.addRibbonIcon("cloud", "Publish to Confluence", async () => {
			if (this.isSyncing) {
				new Notice("Syncing already on going");
				return;
			}
			this.isSyncing = true;
			try {
				const stats = await this.doPublish();
				new CompletedModal(this.app, {
					uploadResults: stats,
				}).open();
			} catch (error) {
				if (error instanceof Error) {
					new CompletedModal(this.app, {
						uploadResults: {
							errorMessage: error.message,
							failedFiles: [],
							filesUploadResult: [],
						},
					}).open();
				} else {
					new CompletedModal(this.app, {
						uploadResults: {
							errorMessage: JSON.stringify(error),
							failedFiles: [],
							filesUploadResult: [],
						},
					}).open();
				}
			} finally {
				this.isSyncing = false;
			}
		});

		this.addCommand({
			id: "adf-to-markdown",
			name: "ADF To Markdown",
			callback: async () => {
				console.log("HMMMM");
				const json = JSON.parse(
					'{"type":"doc","content":[{"type":"paragraph","content":[{"text":"Testing","type":"text"}]}],"version":1}',
				);
				console.log({ json });

				const confluenceClient = new ObsidianConfluenceClient({
					host: this.settings.confluenceBaseUrl,
					authentication: {
						basic: {
							email: this.settings.atlassianUserName,
							apiToken: this.settings.atlassianApiToken,
						},
					},
				});
				const testingPage =
					await confluenceClient.content.getContentById({
						id: "9732097",
						expand: ["body.atlas_doc_format", "space"],
					});
				const adf = JSON.parse(
					testingPage.body?.atlas_doc_format?.value ||
						'{type: "doc", content:[]}',
				);
				renderADFDoc(adf);
			},
		});

		this.addCommand({
			id: "publish-current",
			name: "Publish Current File to Confluence",
			checkCallback: (checking: boolean) => {
				if (!this.isSyncing) {
					if (!checking) {
						this.isSyncing = true;
						this.doPublish(this.activeLeafPath(this.workspace))
							.then((stats) => {
								new CompletedModal(this.app, {
									uploadResults: stats,
								}).open();
							})
							.catch((error) => {
								if (error instanceof Error) {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: error.message,
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								} else {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: JSON.stringify(error),
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								}
							})
							.finally(() => {
								this.isSyncing = false;
							});
					}
					return true;
				}
				return true;
			},
		});

		this.addCommand({
			id: "publish-all",
			name: "Publish All to Confluence",
			checkCallback: (checking: boolean) => {
				if (!this.isSyncing) {
					if (!checking) {
						this.isSyncing = true;
						this.doPublish()
							.then((stats) => {
								new CompletedModal(this.app, {
									uploadResults: stats,
								}).open();
							})
							.catch((error) => {
								if (error instanceof Error) {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: error.message,
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								} else {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: JSON.stringify(error),
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								}
							})
							.finally(() => {
								this.isSyncing = false;
							});
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: "page-settings",
			name: "Update Confluence Page Settings",
			editorCallback: (_editor, view) => {
				if (!view.file) {
					return false;
				}

				const frontMatter = this.app.metadataCache.getCache(
					view.file.path,
				)?.frontmatter;

				const file = view.file;

				new ConfluencePerPageForm(this.app, {
					config: ConfluencePageConfig.conniePerPageConfig,
					initialValues:
						mapFrontmatterToConfluencePerPageUIValues(frontMatter),
					onSubmit: (values, close) => {
					const valuesToSet: Partial<ConfluencePageConfig.ConfluencePerPageAllValues> =
						{};
					for (const propertyKey in values) {
						if (propertyKey === "publish") {
							continue;
						}
							if (
								Object.prototype.hasOwnProperty.call(
									values,
									propertyKey,
								)
							) {
								const element =
									values[
										propertyKey as keyof ConfluencePerPageUIValues
									];
								if (element.isSet) {
									valuesToSet[
										propertyKey as keyof ConfluencePerPageUIValues
									] = element.value as never;
								}
							}
						}
						this.adaptor.updateMarkdownValues(
							file.path,
							valuesToSet,
						);
						close();
					},
				}).open();
				return true;
			},
		});

		this.addSettingTab(new ConfluenceSettingTab(this.app, this));
	}

	override async onunload() {
		this.clearLiveSyncQueue();
		this.clearIntervalSyncTask();
		this.statusBarEl?.remove();
		this.statusBarEl = null;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			ConfluenceUploadSettings.DEFAULT_SETTINGS,
			{
				mermaidTheme: "match-obsidian",
				liveSyncEnabled: false,
				liveSyncDebounceSeconds: 5,
				liveSyncStrategy: "on-save",
				liveSyncIntervalMinutes: 30,
				orphanCleanupIntervalHours: 24,
			},
			{ keyBacklink: "", backlinkPublishState: {} },
			await this.loadData(),
		);
		this.settings.keyBacklink = this.settings.keyBacklink ?? "";
		this.settings.folderToPublish =
			this.settings.folderToPublish?.trim() ?? "";
		this.settings.backlinkPublishState =
			this.settings.backlinkPublishState ?? {};
		this.settings.liveSyncHashes = this.settings.liveSyncHashes ?? {};
		this.settings.liveSyncEnabled = this.settings.liveSyncEnabled ?? false;
		this.settings.liveSyncDebounceSeconds =
			this.settings.liveSyncDebounceSeconds ?? 5;
		this.settings.liveSyncStrategy =
			(this.settings.liveSyncStrategy as
				| "on-save"
				| "interval"
				| "both") ?? "on-save";
		this.settings.liveSyncIntervalMinutes = Math.max(
			1,
			this.settings.liveSyncIntervalMinutes ?? 30,
		);
		this.settings.orphanCleanupIntervalHours = Math.max(
			1,
			this.settings.orphanCleanupIntervalHours ?? 24,
		);
		this.settings.lastOrphanCleanupTs =
			this.settings.lastOrphanCleanupTs ?? 0;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.init();
	}

	private getNormalizedBacklinkKey(): string {
		return normalizeBacklinkKey(this.settings.keyBacklink);
	}

	private ensureBacklinkState(): Record<string, string> {
		if (!this.settings.backlinkPublishState) {
			this.settings.backlinkPublishState = {};
		}
		return this.settings.backlinkPublishState;
	}

	private async removeBacklinkOrphans(
		currentEligiblePaths: Set<string>,
	): Promise<BacklinkCleanupStats> {
		const state = this.ensureBacklinkState();
		const stats: BacklinkCleanupStats = {
			deletedPaths: [],
			failedDeletions: [],
		};
		const staleEntries = Object.entries(state).filter(
			([path]) => !currentEligiblePaths.has(path),
		);
		if (staleEntries.length === 0) {
			return stats;
		}
		if (!this.confluenceClient) {
			return stats;
		}
		let mutated = false;
		for (const [path, pageId] of staleEntries) {
			if (!pageId) {
				delete state[path];
				mutated = true;
				continue;
			}
			try {
				await this.confluenceClient.content.deleteContent({
					id: pageId,
				});
				delete state[path];
				stats.deletedPaths.push(path);
				mutated = true;
				await this.adaptor.clearConfluencePageId(path);
			} catch (error) {
				if (this.isConfluenceNotFound(error)) {
					delete state[path];
					stats.deletedPaths.push(path);
					mutated = true;
					await this.adaptor.clearConfluencePageId(path);
					continue;
				}
				const reason =
					error instanceof Error ? error.message : JSON.stringify(error);
				stats.failedDeletions.push({ path, reason });
				console.error("Failed to delete Confluence page", {
					path,
					pageId,
					error,
				});
			}
		}
		if (mutated) {
			await this.saveData(this.settings);
		}
		return stats;
	}

	private async updateBacklinkState(results: PublisherResult): Promise<void> {
		const state = this.ensureBacklinkState();
		let mutated = false;
		for (const result of results) {
			const path = result.node.file.absoluteFilePath;
			const pageId = result.node.file.pageId;
			if (pageId) {
				if (state[path] !== pageId) {
					state[path] = pageId;
					mutated = true;
				}
			} else if (state[path]) {
				delete state[path];
				mutated = true;
			}
		}
		if (mutated) {
			await this.saveData(this.settings);
		}
	}

	private ensureLiveSyncListener() {
		if (this.liveSyncListenerRegistered) {
			return;
		}
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.onVaultFileModified(file);
			}),
		);
		this.liveSyncListenerRegistered = true;
	}

	private syncLiveSyncRuntimeState() {
		if (!this.settings.liveSyncEnabled) {
			this.clearLiveSyncQueue();
			this.clearIntervalSyncTask();
			this.updateStatusBar("idle");
			return;
		}
		if (!this.shouldUseOnSaveSync()) {
			this.clearLiveSyncQueue();
		}
		this.ensureIntervalSyncTask();
	}

	private clearLiveSyncQueue() {
		this.liveSyncQueue.clear();
		if (this.liveSyncTimeout !== null) {
			window.clearTimeout(this.liveSyncTimeout);
			this.liveSyncTimeout = null;
		}
		if (!this.isSyncing) {
			this.updateStatusBar("idle");
		}
	}

	private async onVaultFileModified(file: TAbstractFile) {
		if (!this.settings.liveSyncEnabled || !this.shouldUseOnSaveSync()) {
			return;
		}
		if (!(file instanceof TFile)) {
			return;
		}
		if (file.extension !== "md") {
			return;
		}
		if (!this.isFileEligibleForLiveSync(file)) {
			return;
		}
		this.liveSyncQueue.add(file.path);
		this.updateStatusBar("pending", this.liveSyncQueue.size);
		this.scheduleLiveSync();
	}

	private isFileEligibleForLiveSync(file: TFile): boolean {
		const folderFilter = this.settings.folderToPublish?.trim() ?? "";
		const normalizedFolder = folderFilter.replace(/\/+$/, "");
		const folderFilterActive = normalizedFolder.length > 0;
		const normalizedKey = this.getNormalizedBacklinkKey();
		const backlinkFilterActive = normalizedKey.length > 0;

		const isInFolder = folderFilterActive
			? file.path === normalizedFolder ||
			  file.path.startsWith(`${normalizedFolder}/`)
			: false;

		if (folderFilterActive && isInFolder) {
			return true;
		}

		if (folderFilterActive && !backlinkFilterActive) {
			return false;
		}

		if (!folderFilterActive && !backlinkFilterActive) {
			return true;
		}

		if (!backlinkFilterActive) {
			return true;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) {
			return false;
		}
		const normalizedNeedle = normalizedKey.toLowerCase();
		const matchesLinks =
			cache.links?.some((link) =>
				normalizeBacklinkKey(link.link ?? "").toLowerCase() ===
				normalizedNeedle,
			) ?? false;
		if (matchesLinks) {
			return true;
		}
		const matchesEmbeds =
			cache.embeds?.some((embed) =>
				normalizeBacklinkKey(embed.link ?? "").toLowerCase() ===
				normalizedNeedle,
			) ?? false;
		return matchesEmbeds;
	}

	private scheduleLiveSync(delayOverride?: number) {
		if (this.liveSyncTimeout !== null) {
			window.clearTimeout(this.liveSyncTimeout);
		}
		const seconds = delayOverride ?? this.settings.liveSyncDebounceSeconds ?? 5;
		const delay = Math.max(0, seconds) * 1000;
		this.liveSyncTimeout = window.setTimeout(() => {
			this.liveSyncTimeout = null;
			void this.flushLiveSyncQueue();
		}, delay);
	}

	private async flushLiveSyncQueue() {
		if (!this.settings.liveSyncEnabled) {
			this.clearLiveSyncQueue();
			return;
		}
		if (this.liveSyncQueue.size === 0) {
			await this.maybeRunOrphanCleanup();
			if (!this.isSyncing) {
				this.updateStatusBar("idle");
			}
			return;
		}
		if (this.isSyncing) {
			this.scheduleLiveSync();
			return;
		}
		const queuedPaths = Array.from(this.liveSyncQueue);
		this.liveSyncQueue.clear();
		const targets: { path: string; hash: string }[] = [];
		for (const path of queuedPaths) {
			const currentHash = await this.computeFileHash(path);
			if (!currentHash) {
				continue;
			}
			if (this.settings.liveSyncHashes?.[path] === currentHash) {
				continue;
			}
			targets.push({ path, hash: currentHash });
		}
		if (!targets.length) {
			await this.maybeRunOrphanCleanup();
			this.updateStatusBar("idle");
			return;
		}
		this.isSyncing = true;
		this.updateStatusBar("syncing", targets.length);
		try {
			let hashesUpdated = false;
			for (const target of targets) {
				try {
					const result = await this.doPublish(target.path, {
						skipCleanup: true,
					});
					if (result.failedFiles.length === 0) {
						this.settings.liveSyncHashes[target.path] = target.hash;
						hashesUpdated = true;
					}
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: "Unknown error";
					new Notice(`Live sync failed: ${message}`);
					console.error("Live sync publish failed", error);
				}
			}
			if (hashesUpdated) {
				await this.saveData(this.settings);
			}
		} finally {
			this.isSyncing = false;
			if (this.liveSyncQueue.size === 0) {
				this.updateStatusBar("idle");
			}
			await this.maybeRunOrphanCleanup();
		}
	}

	private async computeFileHash(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}
		try {
			const contents = await this.app.vault.read(file);
			return SparkMD5.hash(contents);
		} catch (error) {
			console.error("Failed to hash file for live sync", { path, error });
			return null;
		}
	}

	private setupStatusBar() {
		if (!this.statusBarEl) {
			this.statusBarEl = this.addStatusBarItem();
		}
		this.updateStatusBar("idle");
	}

	private updateStatusBar(
		state: "idle" | "pending" | "syncing",
		detail?: number,
	) {
		if (!this.statusBarEl) {
			return;
		}
		let label = "Confluence: Idle";
		switch (state) {
			case "pending":
				label = `Confluence: Pending${detail ? ` (${detail})` : ""}`;
				break;
			case "syncing":
				label = `Confluence: Syncing${detail ? ` (${detail})` : ""}`;
				break;
			default:
				label = "Confluence: Idle";
		}
		this.statusBarEl.setText(label);
	}

	private shouldUseOnSaveSync(): boolean {
		if (!this.settings.liveSyncEnabled) {
			return false;
		}
		const strategy = this.settings.liveSyncStrategy ?? "on-save";
		return strategy === "on-save" || strategy === "both";
	}

	private shouldUseIntervalSync(): boolean {
		if (!this.settings.liveSyncEnabled) {
			return false;
		}
		const strategy = this.settings.liveSyncStrategy ?? "on-save";
		return strategy === "interval" || strategy === "both";
	}

	private ensureIntervalSyncTask() {
		this.clearIntervalSyncTask();
		if (!this.shouldUseIntervalSync()) {
			return;
		}
		const minutes = Math.max(1, this.settings.liveSyncIntervalMinutes ?? 30);
		const intervalMs = minutes * 60 * 1000;
		const intervalId = window.setInterval(() => {
			void this.handleIntervalSyncTick();
		}, intervalMs);
		this.liveSyncIntervalId = intervalId;
		this.registerInterval(intervalId);
	}

	private clearIntervalSyncTask() {
		if (this.liveSyncIntervalId !== null) {
			window.clearInterval(this.liveSyncIntervalId);
			this.liveSyncIntervalId = null;
		}
	}

	private async handleIntervalSyncTick() {
		if (!this.shouldUseIntervalSync()) {
			return;
		}
		const eligiblePaths = this.collectEligibleLiveSyncPaths();
		if (eligiblePaths.length) {
			for (const path of eligiblePaths) {
				this.liveSyncQueue.add(path);
			}
			this.updateStatusBar("pending", this.liveSyncQueue.size);
			await this.flushLiveSyncQueue();
		} else {
			await this.maybeRunOrphanCleanup();
		}
		this.pruneMissingLiveSyncHashes();
	}

	private collectEligibleLiveSyncPaths(): string[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.isFileEligibleForLiveSync(file))
			.map((file) => file.path);
	}

	private pruneMissingLiveSyncHashes() {
		const hashes = this.settings.liveSyncHashes;
		let mutated = false;
		for (const path of Object.keys(hashes)) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file) {
				delete hashes[path];
				mutated = true;
			}
		}
		if (mutated) {
			void this.saveData(this.settings);
		}
	}

	private async maybeRunOrphanCleanup(force = false) {
		const intervalHours = Math.max(
			1,
			this.settings.orphanCleanupIntervalHours ?? 24,
		);
		const intervalMs = intervalHours * 60 * 60 * 1000;
		const last = this.settings.lastOrphanCleanupTs ?? 0;
		const now = Date.now();
		if (!force && now - last < intervalMs) {
			return;
		}
		const eligiblePaths = new Set(this.collectEligibleLiveSyncPaths());
		const stats = await this.removeBacklinkOrphans(eligiblePaths);
		if (stats.deletedPaths.length || stats.failedDeletions.length) {
			this.notifyBacklinkCleanup(stats);
		}
		this.settings.lastOrphanCleanupTs = now;
		await this.saveData(this.settings);
	}

	async runOrphanCleanupNow() {
		await this.maybeRunOrphanCleanup(true);
	}

	private notifyBacklinkCleanup(stats: BacklinkCleanupStats) {
		if (!stats.deletedPaths.length && !stats.failedDeletions.length) {
			return;
		}
		const parts = [] as string[];
		if (stats.deletedPaths.length) {
			parts.push(
				`${stats.deletedPaths.length} Confluence page(s) removed after backlink removal.`,
			);
		}
		if (stats.failedDeletions.length) {
			parts.push(
				`${stats.failedDeletions.length} page removal(s) failed; check console logs.`,
			);
		}
		new Notice(parts.join(" "));
	}

	private isConfluenceNotFound(error: unknown): boolean {
		if (!error) {
			return false;
		}
		if (error instanceof HTTPError) {
			return error.response.status === 404;
		}
		const maybeError = error as {
			statusCode?: number;
			message?: string;
			body?: { statusCode?: number };
			response?: { status?: number; data?: { statusCode?: number } };
		};
		if (maybeError.statusCode === 404) {
			return true;
		}
		if (maybeError.body?.statusCode === 404) {
			return true;
		}
		if (maybeError.response?.status === 404) {
			return true;
		}
		if (maybeError.response?.data?.statusCode === 404) {
			return true;
		}
		const message =
			typeof maybeError.message === "string"
				? maybeError.message
				: typeof error === "string"
					? error
					: undefined;
		if (!message) {
			return false;
		}
		return (
			message.includes("NotFoundException") ||
			message.includes("\"statusCode\":404")
		);
	}
}
