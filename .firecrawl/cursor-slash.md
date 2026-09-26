[Skip to main content](https://cursor.com/docs/cli/reference/slash-commands#main-content)

## Command Palette

Search for a command to run...

## Get Started

[Welcome](https://cursor.com/docs) [Quickstart](https://cursor.com/docs/get-started/quickstart)
Models & Pricing
[Changelog](https://cursor.com/changelog)

## Agent

[Overview](https://cursor.com/docs/agent/overview) [Agents Window](https://cursor.com/docs/agent/agents-window) [Projects](https://cursor.com/docs/agent/projects) [Agent Review](https://cursor.com/docs/agent/agent-review) [Planning](https://cursor.com/docs/agent/plan-mode) [Prompting](https://cursor.com/docs/agent/prompting) [Debugging](https://cursor.com/docs/agent/debug-mode) [Design Mode](https://cursor.com/docs/agent/design-mode)
Tools

Security

## Grok Bot

[Overview](https://cursor.com/docs/grok-bot) [Get Started](https://cursor.com/docs/grok-bot/get-started) [Use Cases](https://cursor.com/docs/grok-bot/use-cases) [Work with Grok Bot](https://cursor.com/docs/grok-bot/work) [Settings](https://cursor.com/docs/grok-bot/settings)
Teams and Enterprise

## Customize

[Overview](https://cursor.com/docs/customize-cursor) [Plugins](https://cursor.com/docs/plugins) [Rules](https://cursor.com/docs/rules) [Skills](https://cursor.com/docs/skills) [Subagents](https://cursor.com/docs/subagents) [Hooks](https://cursor.com/docs/hooks) [MCP](https://cursor.com/docs/mcp)

## Cloud Agents

[Overview](https://cursor.com/docs/cloud-agent) [Setup](https://cursor.com/docs/cloud-agent/setup) [Builds](https://cursor.com/docs/cloud-agent/builds)
Capabilities
[Best Practices](https://cursor.com/docs/cloud-agent/best-practices) [Choose Where Cloud Agents Run](https://cursor.com/docs/cloud-agent/self-hosted/choose-runtime) [Automations](https://cursor.com/docs/cloud-agent/automations) [Bugbot](https://cursor.com/docs/bugbot) [Security Agents](https://cursor.com/docs/security-agents) [PR Routing & Approval](https://cursor.com/docs/approval-agents) [Rollouts](https://cursor.com/docs/rollouts) [Mobile](https://cursor.com/docs/cloud-agent/mobile)
Security

Self-Hosted Machines
[Settings](https://cursor.com/docs/cloud-agent/settings) [API](https://cursor.com/docs/cloud-agent/api/endpoints)

## Origin

[Overview](https://cursor.com/docs/origin)
CLI
[Create a repository](https://cursor.com/docs/origin/create-repository) [Clone, Push & Pull](https://cursor.com/docs/origin/git) [CloneKit in CI](https://cursor.com/docs/origin/clonekit-ci) [Mirror GitHub](https://cursor.com/docs/origin/mirror-github) [Pull requests](https://cursor.com/docs/origin/pull-requests) [Browse & Search](https://cursor.com/docs/origin/browse) [Settings](https://cursor.com/docs/origin/settings) [Codebase settings](https://cursor.com/docs/origin/codebase-settings) [Integrations](https://cursor.com/docs/origin/integrations)

## Integrations

[Slack](https://cursor.com/docs/integrations/slack) [Microsoft Teams](https://cursor.com/docs/integrations/microsoft-teams) [Jira](https://cursor.com/docs/integrations/jira) [Linear](https://cursor.com/docs/integrations/linear) [Notion](https://cursor.com/docs/integrations/notion) [GitHub](https://cursor.com/docs/integrations/github) [GitLab](https://cursor.com/docs/integrations/gitlab) [Azure DevOps](https://cursor.com/docs/integrations/azure-devops) [Bitbucket](https://cursor.com/docs/integrations/bitbucket) [JetBrains](https://cursor.com/docs/integrations/jetbrains) [Xcode](https://cursor.com/docs/integrations/xcode) [Deeplinks](https://cursor.com/docs/reference/deeplinks)

## SDK

[TypeScript](https://cursor.com/docs/sdk/typescript) [Python](https://cursor.com/docs/sdk/python) [Bridge](https://cursor.com/docs/sdk/bridge) [Changelog](https://cursor.com/docs/sdk/changelog)

## CLI

[Overview](https://cursor.com/docs/cli/overview) [Installation](https://cursor.com/docs/cli/installation) [Capabilities](https://cursor.com/docs/cli/using) [Changelog](https://cursor.com/docs/cli/changelog) [Shell Mode](https://cursor.com/docs/cli/shell-mode) [ACP](https://cursor.com/docs/cli/acp) [Headless / CI](https://cursor.com/docs/cli/headless)
Reference

[Slash Commands](https://cursor.com/docs/cli/reference/slash-commands)

[Parameters](https://cursor.com/docs/cli/reference/parameters)

[Authentication](https://cursor.com/docs/cli/reference/authentication)

[Permissions](https://cursor.com/docs/cli/reference/permissions)

[Configuration](https://cursor.com/docs/cli/reference/configuration)

## Teams & Enterprise

Teams

Enterprise

CLI

# Slash commands

| Command                 | Description                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/model [filter]`       | Select a model. Press `Tab` to edit.                                                                                |
| `/run-everything [on    | off                                                                                                                 | status]`                                       | Toggle Run Everything or show its status. `/auto-run` is an alias. |
| `/plan [prompt]`        | Switch to Plan mode, show the current plan, or submit a prompt in Plan mode                                         |
| `/ask`                  | Toggle Ask mode for read-only questions                                                                             |
| `/debug [prompt]`       | Toggle Debug mode or submit a prompt in Debug mode                                                                  |
| `/goal [objective]`     | Give the agent a long-lived objective to work towards until it's fully complete. Rolling out.                       |
| `/logs`                 | Show the debug log path and copy it to the clipboard                                                                |
| `/update`               | Update Cursor Agent to the latest version                                                                           |
| `/max-mode`             | Toggle Max Mode on legacy request-based plans                                                                       |
| `/rename <name>`        | Rename the current chat session                                                                                     |
| `/clear`                | Start a new chat session. `/new`, `/new-chat`, and `/newchat` are aliases.                                          |
| `/resume`               | Open recent chats and resume one                                                                                    |
| `/fork`                 | Fork the current chat into a new session                                                                            |
| `/summarize`            | Summarize the conversation to reduce context. `/compress` is an alias.                                              |
| `/rewind`               | Jump back to a previous message                                                                                     |
| `/vim`                  | Toggle Vim keys                                                                                                     |
| `/line-numbers`         | Toggle line numbers in code blocks                                                                                  |
| `/show-thinking`        | Toggle thinking block display                                                                                       |
| `/status-indicators`    | Toggle terminal title status indicators                                                                             |
| `/shell [command]`      | Enter Shell Mode. `/sh` and `/run` are aliases.                                                                     |
| `/about`                | Show CLI version, system, and account info. Also copies it to the clipboard.                                        |
| `/setup-terminal`       | Configure terminal newline keybindings. See [Terminal setup](https://cursor.com/docs/cli/reference/terminal-setup). |
| `/help [command]`       | Show help. Use `/help <command>` for command details.                                                               |
| `/feedback <message>`   | Share feedback with the team                                                                                        |
| `/open`                 | Open the repository's Git root in Cursor. `/cursor` is an alias.                                                    |
| `/copy-request-id`      | Copy the last request ID to the clipboard                                                                           |
| `/copy-conversation-id` | Copy the current conversation ID to the clipboard                                                                   |
| `/logout`               | Sign out from Cursor                                                                                                |
| `/quit`                 | Exit                                                                                                                |
| `/exit`                 | Exit                                                                                                                |
| `/mcp [list             | list-tools] [identifier]`                                                                                           | Manage MCP servers and list tools for a server |
| `/plugin [subcommand]`  | Manage plugins and marketplaces                                                                                     |
| `/config`               | Configure CLI settings interactively                                                                                |
| `/copy`                 | Copy a previous user message to the clipboard                                                                       |
| `/sandbox`              | Configure sandbox mode and network access settings                                                                  |
| `/bedrock [subcommand]` | Configure Bedrock when the Bedrock feature is enabled                                                               |

English

- English
- 简体中文
- Русский
- 日本語
- Português
- Español
