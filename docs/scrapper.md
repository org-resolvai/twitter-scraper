# Periodic Twitter Scraper & Monitor

## Project Goal
The objective is to build a resilient, containerized system that periodically scans a defined list of Twitter (X) accounts, filters their tweets based on specific search terms, and archives the relevant data into a persistent database.

## Architecture

The system is instrumented using **Docker Compose** to orchestrate the following services:

### 1. `twitter-monitor` Service
A Node.js worker service responsible for the core logic.
*   **Role:**
    *   Authenticates with Twitter (using Guest or User auth).
    *   Iterates through a configured list of target accounts.
    *   Fetches the latest tweets from these profiles.
    *   Filters content based on keywords/search terms.
    *   Upserts new data into the database to prevent duplicates.
*   **Lifecycle:** Runs strictly on a periodic schedule (e.g., every 15 minutes) or as a continuous daemon with sleep intervals to respect rate limits.

### 2. `postgres` Service
A PostgreSQL database instance for persistent storage.
*   **Role:** Stores the scraped tweet data.
*   **Schema Strategy:** Utilizes the **`JSONB`** column type for the main tweet data.
    *   Allows storing the raw, unstructured JSON response from the scraper.
    *   Provides flexibility to adapt to upstream API changes without complex migrations.
    *   enables powerful indexing and querying within the JSON document alongside traditional relational data.

## Data Flow

1.  **Configuration:** The monitor service reads a config (file or env vars) defining:
    *   Target Accounts (e.g., `@elonmusk`, `@NASA`)
    *   Keywords (e.g., "Mars", "crypto")
2.  **Scrape:** The service fetches the user's timeline.
3.  **Filter:** Tweets are checked against the keywords.
4.  **Store:** Matching tweets are saved to the `tweets` table in Postgres.
    *   Primary Key: `tweet_id`
    *   Data: `body` (JSONB)

## Implementation Guide

This guide outlines the step-by-step process to build the system described above.

### Phase 1: Infrastructure Setup (Docker)

1.  **Update `docker-compose.yml`:**
    *   Add a `postgres` service using the `postgres:alpine` image.
    *   Configure environment variables for the database (User, Password, DB Name).
    *   Add a named volume for persistent data storage.
    *   Ensure the scraper service depends on the database service.

### Phase 2: Database Layer

2.  **Initialize Schema:**
    *   Create an `init.sql` script to be mounted in the Postgres container.
    *   Define the `tweets` table with:
        *   `tweet_id` (Text/VarChar, Primary Key)
        *   `body` (JSONB)
        *   `created_at` (Timestamp, Default Now)
        *   `scraped_at` (Timestamp, Default Now)

### Phase 3: Application Logic (The "Monitor")

3.  **Add Dependencies:**
    *   Install `pg` (Postgres client) and `@types/pg`.
    *   Install `dotenv` for configuration management.

4.  **Create Monitor Script (`src/monitor.ts`):**
    *   **Config:** Load target accounts and keywords from environment variables (e.g., `TARGET_ACCOUNTS=elonmusk,NASA`, `KEYWORDS=mars,crypto`).
    *   **DB Connection:** Initialize a connection pool to the Postgres container.
    *   **Scraping Logic:**
        *   Instantiate the `Scraper` class.
        *   Implement a `run()` function that iterates through the accounts.
        *   Use `scraper.getTweets()` to fetch the latest timeline.
    *   **Filtering & Storage:**
        *   Iterate through fetched tweets.
        *   Check if tweet text contains any keywords.
        *   If match: Execute an `INSERT ... ON CONFLICT (tweet_id) DO UPDATE` query to save the raw JSON.
    *   **Scheduling:** Wrap the logic in a `setInterval` or use a cron-like scheduler to run every X minutes.

### Phase 4: Integration & Build

5.  **Update Build Configuration:**
    *   Ensure `src/monitor.ts` is compiled/transpiled correctly along with the library.
    *   Add a script to `package.json` to run the monitor (e.g., `"monitor": "node dist/monitor.js"`).

6.  **Finalize Docker Environment:**
    *   Update the `twitter-scraper` service in `docker-compose.yml` to run the monitor command by default (or as an override).
    *   Pass the necessary `POSTGRES_CONNECTION_STRING` env var to the scraper service.

### Phase 5: Verification

7.  **Test Run:**
    *   Run `docker-compose up`.
    *   Verify logs show successful scraping and database insertion.
    *   Connect to the Postgres container and query the `tweets` table to verify data integrity.