# Obsidian Atlassian Integration Plugin

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/markdown-confluence/markdown-confluence/badge)](https://api.securityscorecards.dev/projects/github.com/markdown-confluence/markdown-confluence)

Copyright (c) 2022 Atlassian Pty Ltd

Copyright (c) 2022 Atlassian US, Inc.

`Obsidian Atlassian Integration Plugin` is an open-source plugin for [Obsidian.md](https://obsidian.md/) that allows you to publish markdown content from Obsidian to [Atlassian Confluence](https://www.atlassian.com/software/confluence). It supports [Obsidian markdown extensions](https://help.obsidian.md/How+to/Format+your+notes) for richer content and includes a CLI for pushing markdown files from the command line. Currently, the plugin only supports Atlassian Cloud instances.

## Features

- Publish Obsidian notes to Atlassian Confluence
- Support for Obsidian markdown extensions
- CLI for pushing markdown files from disk
- Commands and ribbon icon for easy access

## Issues
Please log issues to https://github.com/markdown-confluence/markdown-confluence/issues as this is where the code is being developed. 

## Installation (via BRAT)

The plugin is currently distributed through the community-maintained **Beta Reviewers Auto-update Tester (BRAT)** plugin.

1. Install and enable BRAT from Obsidian's community plugins browser.
2. In BRAT's settings, choose **Add Beta plugin** and enter this repository URL (`callummclennan/obsidian-confluence`).
3. BRAT will download the latest build and keep it updated; enable `Atlassian Integration` when prompted.

Alternatively, download the latest `atlassian-integration.zip` from the [Releases](./release/) folder and drop the extracted plugin into `.obsidian/plugins/`.

## Getting Started

Once installed, open **Settings → Community Plugins → Atlassian Integration** and configure:

- `Confluence Base URL`: The base URL of your Atlassian Confluence instance (e.g., `https://your-domain.atlassian.net`)
- `Confluence Parent Id`: The Confluence page ID where your notes will be published as child pages
- `Atlassian User Name`: Your Atlassian account's email address
- `Atlassian API Token`: Your Atlassian API token. You can generate one from your [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens).
- `Folder To Publish`: The name of the folder in Obsidian containing the notes you want to publish (default: "Confluence Pages")
- `Required Wikilink`: Optional wikilink (default `[[atlassian]]`) that, when present in a note, marks it for publishing even if it lives outside the folder. You can set a custom value in the plugin settings.

![Settings](./docs/screenshots/settings.png)

## Usage

### Ribbon Icon

Click the cloud icon in the ribbon to publish the notes from the configured folder to Confluence.

![Ribbon icon](./docs/screenshots/ribbon.png)


### Commands

Use the command palette (`Ctrl/Cmd + P`) to execute the "Publish All to Confluence" command, which publishes all the notes from the configured folder to Confluence.

![Commands](./docs/screenshots/commands.png)

### Example Workflow
1. Install and configure the `atlassian-integration` plugin.
2. Create a folder in your Obsidian vault named "Confluence Pages" (or the folder name you specified in the settings).
3. Add notes to this folder or include the configured wikilink (default `[[atlassian]]`) anywhere in the note body to publish from outside the folder.
4. Click the cloud icon in the ribbon or use the "Publish All to Confluence" command to publish your notes to Confluence.

### Wikilink Publishing Cheat Sheet

- Set your preferred wikilink key under **Settings → Atlassian Integration → Required Wikilink** (default is `atlassian`).
- Any note containing `[[<your-key>]]` will be considered for publishing even if it lives outside the configured folder.
- Notes inside the publish folder still upload without the wikilink; the link simply opts external notes in.
- The plugin strips the helper wikilink before sending content to Confluence, so it never appears on the final page.

### Contributing
Contributions are welcome! If you have a feature request, bug report, or want to improve the plugin, please open an issue or submit a pull request on the GitHub repository.

### License
This project is licensed under the [Apache 2.0](https://github.com/markdown-confluence/markdown-confluence/blob/main/LICENSE) License.

## Disclaimer:
The Apache license is only applicable to the Obsidian Atlassian Integration (“Integration“), not to any third parties' services, websites, content or platforms that this Integration may enable you to connect with.  In another word, there is no license granted to you by the above identified licensor(s) to access any third-party services, websites, content, or platforms.  You are solely responsible for obtaining licenses from such third parties to use and access their services and to comply with their license terms. Please do not disclose any passwords, credentials, or tokens to any third-party service in your contribution to this Obsidian Atlassian Integration project.”
