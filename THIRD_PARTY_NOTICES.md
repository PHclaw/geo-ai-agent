# Third-Party Notices

GEO AI Agent is distributed under the **Apache License 2.0** (see `LICENSE`).
It builds on the following third-party packages, each under its own license.

## Backend — `server/`

| Package | Version | License | Project |
| --- | --- | --- | --- |
| cheerio | ^1.2.0 | MIT | https://github.com/cheeriojs/cheerio |
| express | ^4.21.2 | MIT | https://github.com/expressjs/express |
| fast-xml-parser | ^5.11.2 | MIT | https://github.com/NaturalIntelligence/fast-xml-parser |
| jszip | ^3.10.2 | MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip |
| mammoth | ^1.13.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| multer | ^2.5.0 | MIT | https://github.com/expressjs/multer |
| papaparse | ^5.7.0 | MIT | https://github.com/mrplock/papaparse |
| pdfjs-dist | ^6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| sharp | ^0.35.5 | Apache-2.0 | https://github.com/lovell/sharp |
| xlsx | ^0.18.5 | Apache-2.0 | https://github.com/SheetJS/sheetjs |

## Frontend — `prototype/react/`

| Package | Version | License | Project |
| --- | --- | --- | --- |
| react / react-dom | ^19.1.0 | MIT | https://github.com/facebook/react |
| react-router-dom | ^7.6.0 | MIT | https://github.com/remix-run/react-router |
| tailwindcss / @tailwindcss/vite | ^4.1.11 | MIT | https://github.com/tailwindlabs/tailwindcss |
| vite | ^7.0.0 | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | ^5.0.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| typescript | ^5.8.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/react / @types/react-dom | ^19.1.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

All of the above are permissively licensed and compatible with Apache-2.0. Two notes:

- `jszip` is dual-licensed; this project uses it under the **MIT** option.
- `xlsx` is pinned to **0.18.x** on purpose, because SheetJS changed its licensing terms in 0.19+.

**Runtime tool, not a library dependency**: the `pi` CLI is invoked as a child process and is licensed separately by its own authors.
