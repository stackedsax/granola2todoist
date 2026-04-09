# granola2todoist

Automatically syncs action items from [Granola](https://granola.ai) meeting notes into [Todoist](https://todoist.com) tasks.

Runs every 30 minutes via launchd, reads new meeting notes via the Granola MCP API, extracts action items assigned to you, and creates tasks in the appropriate Todoist project.

## Features

- Authenticates with Granola via OAuth (browser flow on first run, token cached thereafter)
- Routes tasks to different Todoist projects based on which Google Calendar the meeting was on, with domain-based fallback routing
- Handles nested Next Steps sections (e.g. `- Alex / - Dave` with indented sub-tasks)
- Retries meetings whose notes haven't been generated yet, and auto-triggers Granola's "Enhance Notes" to kick off summarisation
- All personal config lives outside the repo in `~/.granola2todoist-config.json`

## Requirements

- macOS (uses Granola's local cache and launchd)
- Node.js 18+
- A [Todoist API token](https://todoist.com/app/settings/integrations/developer)
- Granola installed and running

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your config file

Copy `config.example.json` to `~/.granola2todoist-config.json` and fill in your details:

```json
{
  "todoistApiToken": "your-todoist-api-token",
  "personName": "Your Name",
  "todoistSection": "Generated Tasks",
  "defaultProject": "Inbox",
  "domainProjects": {
    "@mycompany.com": "Work"
  },
  "calendarToProject": {
    "My Work Calendar": "Work",
    "Personal": "Personal"
  }
}
```

- **`personName`** — your name as it appears in meeting notes (used to filter action items assigned to you)
- **`defaultProject`** — Todoist project to use when no calendar or domain match is found
- **`domainProjects`** — map of email domains to Todoist project names (for participant-based routing)
- **`calendarToProject`** — map of Google Calendar names to Todoist project names (primary routing, read from Granola's local cache)

### 3. Authenticate with Granola

Run once manually to complete the OAuth flow:

```bash
node index.js
```

A browser window will open for you to authorise the app. The token is saved to `~/.granola2todoist-oauth.json`.

### 4. Install the launchd agent (optional)

To run automatically every 30 minutes:

```bash
# Edit com.granola2todoist.plist and update the path to this directory
cp com.granola2todoist.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.granola2todoist.plist
```

Logs are written to `/tmp/granola2todoist.log` and `/tmp/granola2todoist.err`.

## State

The state file at `~/.granola2todoist-state.json` tracks which meetings have been processed. To reprocess meetings from a specific date, update `lastProcessedAt` manually:

```json
{ "lastProcessedAt": "2026-01-01T00:00:00.000Z", "processedMeetingIds": [], "pendingIds": [] }
```
