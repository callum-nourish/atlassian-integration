# Backlink-Gated Publishing Plan

## Summary
Introduce a configurable "key backlink" (e.g. `[[atlassian]]`) that governs which notes the Obsidian → Confluence pipeline is allowed to publish. Only Markdown files whose body text contains the configured wiki-link will be eligible, and the upload payload must mirror their folder hierarchy from the vault root while omitting non-eligible siblings. Removing the backlink should trigger a deletion (or archival) of that page in Confluence to keep both systems consistent. All logic must execute locally inside the Obsidian plugin to satisfy data-protection expectations.

## Functional Requirements
- **Configurable key term** – Add a string field to plugin settings; default empty disables the feature. Persist it alongside existing Confluence settings and expose it via the settings tab UI.
- **Eligibility filter** – During publish, scan each candidate file’s Markdown body (excluding frontmatter/metadata) for the literal `[[<key>]]` text. Reject files missing the backlink even if they are selected via `folderToPublish`.
- **Folder mirroring** – When uploading eligible files, preserve their relative path from the vault root inside Confluence. Skip folders that would otherwise only contain ineligible notes to avoid empty stubs.
- **De-publish on removal** – Track which Confluence page IDs originated from backlink-qualified notes. On each run, detect previously published pages whose source files no longer include the backlink and call the delete/unpublish API for those pages.
- **Offline/local only** – Ensure scanning and filtering happens entirely client-side; do not transmit file contents unless the backlink rule passes.

## Implementation Outline
1. **Settings extension**
   - Extend `ObsidianPluginSettings` with `keyBacklink?: string` (trimmed string, optional).
   - Update `ConfluenceSettingTab` form + save/load methods to surface the new field.
2. **Scanning utility**
   - Add helper (e.g., `containsKeyBacklink(file: TFile, key: string)`) under `src/adaptors/` or a new `utils/filters.ts`. Read the file contents via the adaptor, search for `[[${key}]]` using a simple string match (case-sensitive or provide toggle?).
   - Cache results per run to avoid duplicate vault reads.
3. **Eligible-file selection**
   - Hook into the existing Publisher pipeline (likely `ObsidianAdaptor.listFilesToUpload` or equivalent) to filter the file list before upload.
   - Ensure `folderToPublish` and frontmatter overrides still work but only for backlink-qualified files.
4. **Path mirroring**
   - Extend whatever structure builds Confluence page configs (`ConfluencePageConfig`) so that the ancestor hierarchy reflects the vault path segments. For ineligible siblings, skip creating placeholder nodes.
5. **State tracking for removals**
   - Persist a map (file path → Confluence page ID + last backlink hash) in the plugin’s data store.
   - On each publish run: compare previously stored entries against the new eligible set; issue delete calls for any path that lost the backlink or was deleted locally.
   - After successful uploads/deletions, update the map atomically.
6. **User feedback & safety**
   - Surface notices summarizing counts: uploaded, skipped (missing backlink), deleted.
   - If no files qualify, show a notice rather than silently doing nothing.

## Manual Testing Plan
- Configure the key term to `[[atlassian]]` in the settings tab.
- Create three sample notes: (1) eligible note containing the backlink, (2) note in same folder without the backlink, (3) eligible note in another folder. Run publish and confirm only eligible notes appear in Confluence with preserved folder hierarchy.
- Remove the backlink from note (1), rerun publish, and verify that its Confluence page is deleted while other pages remain.
- Re-add the backlink with altered content to ensure the upload path still works after deletion.

## Risks & Mitigations
- **Performance**: Scanning large vaults could be expensive; mitigate with memoization per run and early exits when key is empty.
- **Accidental deletions**: Require confirmation before mass-deleting pages (e.g., prompt when more than N pages would be removed) to avoid user mistakes.
- **Case sensitivity**: Decide and document whether the match is case-sensitive; consider normalizing both key and text for predictability.
