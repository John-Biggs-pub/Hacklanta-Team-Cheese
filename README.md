# Demo Care

**Democratizing your benefit information, one prompt at a time!**

Demo Care is a web application that helps users understand and navigate their health insurance benefits using AI. Scan your insurance card, ask questions about your coverage in plain English, and get confusing medical letters translated into simple language.

## Features

- **Phone Verification** — Quick onboarding with SMS code verification (no passwords)
- **Insurance Card Scanner** — Point your camera at your insurance card and Demo Care reads it automatically using OCR
- **Find Care (AI Chat)** — ChatGPT-style interface to ask questions about your health benefits, coverage, doctors, and more
- **Read a Letter** — Scan any medical letter or Explanation of Benefits (EOB) and get a plain-English summary powered by AI
- **My Extra Benefits** — Discover additional plan benefits like dental, vision, and transportation *(coming soon)*
- **Talk to My Helper** — Live conversation with a personal health benefits assistant *(coming soon)*

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 (via CDN + Babel), single-page app |
| Backend | Node.js + Express |
| Database | SQLite (via sql.js), persisted to file |
| OCR | Tesseract.js (client-side) |
| AI | OpenAI GPT-4o-mini |

## Getting Started

### Prerequisites

- Node.js v18+
- An OpenAI API key (for AI features)

### Installation

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The app will be running at **http://localhost:3000**.

### Configuration

The OpenAI API key is configured in `server.js`. You can also set it via environment variable:

```bash
OPENAI_API_KEY=sk-your-key-here npm start
```

To use a different OpenAI model:

```bash
OPENAI_MODEL=gpt-4o npm start
```

## Project Structure

```
demo-care/
├── server.js          # Express backend, API routes, database, AI integration
├── public/
│   └── index.html     # Single-page React frontend (components, routing, UI)
├── package.json
├── health_helper.db   # SQLite database (auto-created on first run)
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/send-code` | Send a verification code via SMS |
| POST | `/api/verify-code` | Verify the SMS code and authenticate |
| POST | `/api/save-card` | Save scanned insurance card data |
| GET | `/api/cards/:phone` | Retrieve scanned cards for a user |
| POST | `/api/chat` | Send a message to the AI health assistant |
| POST | `/api/summarize-letter` | Summarize a scanned letter in plain English |
| GET | `/api/users` | List all registered users (admin) |
| DELETE | `/api/users/:phone` | Delete a user (admin) |

## License

MIT
