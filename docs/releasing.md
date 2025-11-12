# Release Checklist

Ensure the packaged zip exposes a folder named `atlassian-integration` so it matches `manifest.json`'s `id`. Obsidian refuses to load plugins when the directory name and manifest id disagree.

## Step-by-step

1. **Prep the repo**
   - `git pull obsidian-integration main`
   - Confirm working tree is clean (`git status`).
   - If you bumped plugin version, update both `manifest.json` and `versions.json`.
2. **Install & build**
   - `npm install` (applies `patch-package` and refreshes `package-lock.json`).
   - `npm run build` (runs `tsc` + esbuild, writes `dist/main.js`).
3. **Sanity-test in Obsidian**
   - Copy the previous release folder into `.obsidian/plugins/atlassian-integration`.
   - Replace its `main.js`/`manifest.json` with the freshly built versions.
   - Reload Obsidian and run a quick publish to verify nothing regressed.
4. **Stage release artifact**
   ```sh
   rm -rf release && mkdir -p release/atlassian-integration
   cp manifest.json versions.json dist/main.js release/atlassian-integration/
   [ -f styles.css ] && cp styles.css release/atlassian-integration/
   cd release && zip -r atlassian-integration atlassian-integration
   cd ..
   ```
   Result: `release/atlassian-integration.zip` contains a root folder named `atlassian-integration/`.
5. **Commit, tag, push**
   - `git status` → ensure only intended files changed.
   - `git commit -am "<summary>"`
   - `git tag <version>`
   - `git push obsidian-integration main --tags`
6. **Publish on GitHub**
   - Edit the release for `<version>`.
   - Delete any old zip asset; upload `release/atlassian-integration.zip`.
   - Attach `manifest.json` / `versions.json` separately if marketplace requires them.
   - Note in the release body that the plugin folder is `atlassian-integration` (users on older IDs must rename once).
7. **Verify distribution**
   - Download the uploaded zip, unzip, and confirm the manifest id matches the folder name and includes the right version.
   - Keep the extracted folder handy for quick installs/tests.

Tip: keeping the `release/atlassian-integration` folder around lets you drag it straight into `.obsidian/plugins/` for a final smoke test.
