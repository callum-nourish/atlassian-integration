import { Vault, MetadataCache, App, TFile } from "obsidian";
import {
	ConfluenceUploadSettings,
	BinaryFile,
	FilesToUpload,
	LoaderAdaptor,
	MarkdownFile,
	ConfluencePageConfig,
} from "@markdown-confluence/lib";
import type { ObsidianPluginSettings } from "../main";
import {
	fileContainsKeyBacklink,
	normalizeBacklinkKey,
} from "../backlinkUtils";
import { lookup } from "mime-types";

const collapseExtraNewlines = /\n{3,}/g;

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

const CONFLUENCE_PAGE_ID_FIELD = "confluence-page-id";

export default class ObsidianAdaptor implements LoaderAdaptor {
	vault: Vault;
	metadataCache: MetadataCache;
	settings: ObsidianPluginSettings;
	app: App;

	constructor(
		vault: Vault,
		metadataCache: MetadataCache,
		settings: ObsidianPluginSettings,
		app: App,
	) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.settings = settings;
		this.app = app;
	}

	async getMarkdownFilesToUpload(): Promise<FilesToUpload> {
		const normalizedKey = normalizeBacklinkKey(
			this.settings.keyBacklink,
		);
		const folderToPublish = this.settings.folderToPublish?.trim() ?? "";
		const folderFilterActive = folderToPublish.length > 0;
		const backlinkFilterActive = normalizedKey.length > 0;
		const files = this.vault.getMarkdownFiles();
		const filesToUpload: FilesToUpload = [];

		for (const file of files) {
			try {
				if (file.path.endsWith(".excalidraw")) {
					continue;
				}

				const fileFM = this.metadataCache.getCache(file.path);
				if (!fileFM) {
					throw new Error("Missing File in Metadata Cache");
				}

				const rawContents = await this.vault.cachedRead(file);
				const hasBacklink =
					backlinkFilterActive &&
					fileContainsKeyBacklink(rawContents, normalizedKey);
				const inFolder = folderFilterActive
					? file.path.startsWith(folderToPublish)
					: false;

				const shouldPublish = inFolder || hasBacklink;
				if (!shouldPublish) {
					continue;
				}

				filesToUpload.push(
					this.createMarkdownFilePayload(
						file,
						this.stripRequiredBacklink(rawContents, normalizedKey),
					),
				);
			} catch {
				// ignore individual file failures to continue publishing others
			}
		}

		if (!filesToUpload.length) {
			throw new Error(
				this.buildNoFilesMessage(folderToPublish, normalizedKey),
			);
		}

		return filesToUpload;
	}

	async loadMarkdownFile(absoluteFilePath: string): Promise<MarkdownFile> {
		const file = this.app.vault.getAbstractFileByPath(absoluteFilePath);
		if (!(file instanceof TFile)) {
			throw new Error("Not a TFile");
		}

		const rawContents = await this.vault.cachedRead(file);
		return this.createMarkdownFilePayload(
			file,
			this.stripRequiredBacklink(
				rawContents,
				normalizeBacklinkKey(this.settings.keyBacklink),
			),
		);
	}

	private createMarkdownFilePayload(
		file: TFile,
		contents: string,
	): MarkdownFile {
		const fileFM = this.metadataCache.getCache(file.path);
		if (!fileFM) {
			throw new Error("Missing File in Metadata Cache");
		}
		const frontMatter = fileFM.frontmatter;

		const parsedFrontMatter: Record<string, unknown> = {};
		if (frontMatter) {
			for (const [key, value] of Object.entries(frontMatter)) {
				parsedFrontMatter[key] = value;
			}
		}

		return {
			pageTitle: file.basename,
			folderName: file.parent?.name ?? "",
			absoluteFilePath: file.path,
			fileName: file.name,
			contents,
			frontmatter: parsedFrontMatter,
		};
	}

	private stripRequiredBacklink(
		contents: string,
		normalizedKey: string,
	): string {
		if (!normalizedKey) {
			return contents;
		}
		const escapedKey = escapeRegExp(normalizedKey);
		const backlinkPattern = new RegExp(
			`\\[\\[\\s*${escapedKey}(?:#[^|\\]]+)?(?:\\|[^\\]]+)?\\s*\\]\\]`,
			"gi",
		);
		const withoutBacklink = contents
			.replace(backlinkPattern, "")
			.replace(collapseExtraNewlines, "\n\n")
			.replace(/[ \t]+\n/g, "\n");
		return withoutBacklink;
	}

	private buildNoFilesMessage(
		folderToPublish: string,
		normalizedKey: string,
	): string {
		const parts = [] as string[];
		if (folderToPublish && normalizedKey) {
			parts.push(
				`No markdown files were found inside "${folderToPublish}" and none contained [[${normalizedKey}]].`,
			);
		} else if (folderToPublish) {
			parts.push(
				`No markdown files were found inside "${folderToPublish}" that met the publish filters.`,
			);
		} else if (normalizedKey) {
			parts.push(
				`No markdown files in your vault contain [[${normalizedKey}]].`,
			);
		} else {
			parts.push(
				"No markdown files in your vault met the current publish filters.",
			);
		}

		parts.push(
			"Only notes inside the publish folder or containing the required wikilink will be uploaded.",
		);

		return parts.join(" ");
	}

	async readBinary(
		path: string,
		referencedFromFilePath: string,
	): Promise<BinaryFile | false> {
		const testing = this.metadataCache.getFirstLinkpathDest(
			path,
			referencedFromFilePath,
		);
		if (testing) {
			const files = await this.vault.readBinary(testing);
			const mimeType =
				lookup(testing.extension) || "application/octet-stream";
			return {
				contents: files,
				filePath: testing.path,
				filename: testing.name,
				mimeType: mimeType,
			};
		}

		return false;
	}
	async updateMarkdownValues(
		absoluteFilePath: string,
		values: Partial<ConfluencePageConfig.ConfluencePerPageAllValues>,
	): Promise<void> {
		const config = ConfluencePageConfig.conniePerPageConfig;
		const file = this.app.vault.getAbstractFileByPath(absoluteFilePath);
		if (file instanceof TFile) {
			this.app.fileManager.processFrontMatter(file, (fm) => {
				for (const propertyKey in config) {
					if (!config.hasOwnProperty(propertyKey)) {
						continue;
					}

					const { key } =
						config[
							propertyKey as keyof ConfluencePageConfig.ConfluencePerPageConfig
						];
					const value =
						values[
							propertyKey as keyof ConfluencePageConfig.ConfluencePerPageAllValues
						];
					if (propertyKey in values) {
						fm[key] = value;
					}
				}
			});
		}
	}

	async clearConfluencePageId(absoluteFilePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(absoluteFilePath);
		if (!(file instanceof TFile)) {
			return;
		}
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (fm[CONFLUENCE_PAGE_ID_FIELD]) {
				delete fm[CONFLUENCE_PAGE_ID_FIELD];
			}
		});
	}
}
