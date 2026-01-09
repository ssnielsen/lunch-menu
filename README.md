# Lunch Menu Fetcher

A script to fetch and parse the daily lunch menu from [nooncph.dk](https://www.nooncph.dk/ugens-menuer).

## Features

- Automatically detects current week number and day
- Fetches the menu page and downloads the correct PDF
- Extracts English menu text (page 2 of PDF)
- Removes page numbers
- Optional: Remove allergy information

## Requirements

- Node.js v22.0.0 or higher (with experimental TypeScript support)

## Installation

```bash
npm install
# or
yarn install
```

## Usage

### Fetch today's menu (with allergy info):

```bash
npm run fetch
# or
node --experimental-strip-types fetch-lunch-menu.ts
```

### Fetch today's menu (without allergy info):

```bash
npm run fetch:no-allergies
# or
node --experimental-strip-types fetch-lunch-menu.ts --no-allergies
# or shorthand
node --experimental-strip-types fetch-lunch-menu.ts -na
```

### Show help:

```bash
node --experimental-strip-types fetch-lunch-menu.ts --help
```

## Options

- `--no-allergies`, `-na` - Remove allergy information (numbers in parentheses)
- `--help`, `-h` - Show help message

## How it works

1. Determines the current week number and day of the week
2. Fetches the menu page HTML from nooncph.dk
3. Finds and downloads the appropriate PDF for today
4. Parses the PDF content (English version from page 2)
5. Removes page numbers
6. Optionally removes allergy information
7. Outputs the menu in text format

## Limitations

- Only works on weekdays (Monday-Friday)
- Requires the restaurant to have uploaded the menu for the current week
