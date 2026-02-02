# Implementation Guide: Decoupling Monitor and API Services

This guide provides step-by-step instructions for refactoring the Twitter Scraper architecture. The goal is to separate the scraping logic (API) from the scheduling logic (Monitor) to prevent account flagging.

**Role:** Junior Developer
**Context:** Node.js, TypeScript, Docker
**Prerequisites:** Ensure you have the repository cloned and dependencies installed (`yarn install`).

---

## Phase 1: Fix the API Server (`src/server.ts`)

The current `src/server.ts` file contains broken imports and initialization logic. We must fix this to ensure the API service works before the monitor relies on it.

### Step 1.1: Fix Imports
**File:** `src/server.ts`

**Action:** Remove the broken import pointing to `dist` and the unused `Scraper`/`Tweet` imports. Add the correct import for the CycleTLS wrapper.

**Remove:**
```typescript
import { fetch } from '../dist/cycletls-fetch.js'; // BROKEN
import { Scraper, Tweet, SearchMode } from './scraper';
```

**Add:**
```typescript
import { Scraper, SearchMode } from './scraper';
import { cycleTLSFetch, cycleTLSExit } from './cycletls-fetch';
```

### Step 1.2: Correct Scraper Initialization
**File:** `src/server.ts`

**Action:** Update the `main` function to initialize the Scraper correctly using `cycleTLSFetch`. Remove the undefined `initCycleTLS` call.

**Replace the beginning of `async function main()` with:**
```typescript
async function main() {
  const app = express();
  
  // Initialize Scraper with the specific fetch wrapper
  const scraper = new Scraper({
    fetch: cycleTLSFetch,
  });

  // Ensure CycleTLS exits cleanly when the process terminates
  process.on('exit', () => {
    console.log('Destroying cycletls...');
    cycleTLSExit();
  });

  console.log('Logging into Twitter...');
  // ... rest of the function
```

### Step 1.3: Verify API Build
**Action:** Run the build command to ensure TypeScript compiles without errors.
```bash
yarn build:server
```
*Expected Output:* `dist/server.js` is generated successfully.

---

## Phase 2: Refactor the Monitor (`src/monitor.ts`)

The monitor currently acts as a scraper. We will convert it into a simple HTTP client that queries the API service we just fixed.

### Step 2.1: Clean Up Imports
**File:** `src/monitor.ts`

**Action:** Remove scraper-specific imports. We will need `node-fetch` (or global fetch) to call the API.

**Remove:**
```typescript
import { Scraper } from './scraper';
import { Tweet } from './tweets'; // Tweet type might still be needed for upsertTweet, keep if used as interface
import { SearchMode } from './search';
import { cycleTLSFetch, cycleTLSExit } from './cycletls-fetch';
```

**Ensure:**
You may need to add/keep an import for the tweet interface if `upsertTweet` relies on it. If `Tweet` is just a type, it's fine to keep importing it from `./tweets`.

### Step 2.2: Rewrite `processJob`
**File:** `src/monitor.ts`

**Action:** Change the function signature to remove `Scraper`. Replace the scraping logic with an HTTP request to the API.

**New Signature:**
```typescript
export async function processJob(job: any, poolInstance: Pool = pool) { ... }
```

**New Logic Implementation:**
Replace the `if (job.type === ...)` block with:

```typescript
    // Define the API Base URL (Service discovery name 'api' in Docker, or localhost for dev)
    // You might want to make this an env var: API_URL
    const API_URL = process.env.API_URL || 'http://localhost:3000';
    let results: any[] = [];

    if (job.type === 'profile') {
      const response = await fetch(`${API_URL}/tweets/${job.query}?count=20`);
      if (!response.ok) throw new Error(`API error: ${response.statusText}`);
      const json = await response.json();
      results = json.data; // Assuming API returns { data: [...] }
      
    } else if (job.type === 'search') {
      const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(job.query)}&count=20&mode=Top`);
      if (!response.ok) throw new Error(`API error: ${response.statusText}`);
      const json = await response.json();
      results = json.data;
    }

    // Process results
    for (const tweet of results) {
      // Adapt the API response object to match what upsertTweet expects if necessary
      // If the API returns the exact same object structure, you can pass it directly.
      await upsertTweet(tweet, criteriaTag, client);
      count++;
    }
```

### Step 2.3: Rewrite `runMonitor`
**File:** `src/monitor.ts`

**Action:** Remove all Twitter authentication logic (login/cookies) and CycleTLS initialization.

**Remove:**
*   `Scraper` initialization.
*   `TWITTER_*` env var reading.
*   `scraper.login()` or `scraper.setCookies()` calls.
*   `cycleTLSExit()` in the catch block.

**Update Loop:**
Pass only `job` and `poolInstance` to `processJob`.

```typescript
// Inside the while(true) loop
if (jobs.length > 0) {
  const job = jobs[0];
  await processJob(job, poolInstance); // Removed scraper argument
  // ... rest of the loop
}
```

### Step 2.4: Verify Monitor Build
**Action:** Run the build command.
```bash
yarn build:monitor
```

---

## Phase 3: Configuration (`docker-compose.yml`)

We need to ensure the Monitor no longer has access to Twitter credentials and knows where to find the API.

### Step 3.1: Update Monitor Service
**File:** `docker-compose.yml`

**Action:**
1.  Remove `TWITTER_USERNAME`, `TWITTER_PASSWORD`, etc., from the `monitor` service.
2.  Add `API_URL: http://api:3000` to the `monitor` service environment variables.

**Example:**
```yaml
  monitor:
    build: .
    command: ["yarn", "monitor"]
    environment:
      - DATABASE_URL=...
      - API_URL=http://api:3000 # Docker service name
    depends_on:
      - api
```

### Step 3.2: Update API Service
**File:** `docker-compose.yml`

**Action:** Ensure the `api` service *does* have the `TWITTER_*` credentials.

---

## Verification Checklist

1.  **Build:** Both `yarn build:server` and `yarn build:monitor` succeed.
2.  **Environment:** `docker-compose up --build` starts both services.
3.  **Logs:**
    *   `api` service log should show "Logging into Twitter..." followed by "Login successful".
    *   `monitor` service log should show "Starting job..." and then "API request..." instead of "Scraper...".
4.  **Functionality:** Check the database (`tweets` table) to ensure new tweets are being inserted.
