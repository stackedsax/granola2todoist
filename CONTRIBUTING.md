# Contributing

Contributions are welcome. This is a small personal-automation tool, so the bar for changes is pragmatism over perfection.

## Getting started

```bash
git clone https://github.com/stackedsax/granola2todoist
cd granola2todoist
npm install
cp config.example.json ~/.granola2todoist-config.json
# fill in your details, then:
node index.js
```

## Running tests

```bash
npm test
```

## Linting

```bash
npm run lint
```

## Pull requests

- Keep changes focused — one concern per PR.
- Add or update tests for any logic changes to `granola.js` or `calendar.js`.
- There's no CI yet; please run `npm test && npm run lint` locally before opening a PR.

## Reporting issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened (log output from `/tmp/granola2todoist.log` is helpful)
- A sanitised example of the meeting notes that caused the problem
