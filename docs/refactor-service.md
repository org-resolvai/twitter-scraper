# Refactoring Plan: Decoupling Monitor and API Services

## 1. Goal

The primary goal of this refactoring is to prevent multiple services from logging into the same Twitter account, which can trigger bot detection and cause login failures.

We will centralize all Twitter interactions within the `api` service. The `monitor` service will no longer log in to Twitter directly; instead, it will query the internal `api` service to retrieve the data it needs to process its jobs.

---

## 2. Service Modifications

### `src/server.ts` (Prerequisite)

Before refactoring the monitor, the API server must be fixed to be functional:

1.  **Fix Imports:** Correct the import of `cycleTLSFetch` and `cycleTLSExit` from `./cycletls-fetch` (instead of the broken `../dist/` path).
2.  **Correct Initialization:** Use `cycleTLSFetch` as the fetch implementation for the `Scraper` and remove the undefined `initCycleTLS` call.
3.  **Cleanup Logic:** Ensure `cycleTLSExit()` is called on process termination using `cycleTLSExit()`.

### `src/monitor.ts`

This file will be completely rewritten to perform the following steps:

1.  **Remove Twitter Dependencies:** All code related to the `twitter-scraper` library, `Scraper` class, `cycletls`, and direct Twitter authentication will be removed.
2.  **API Client Logic:** The `processJob` function will be modified. Instead of calling `scraper.getTweets()` or `scraper.searchTweets()`, it will use a standard `fetch` call to the `api` service's endpoints.
    *   For a `profile` job, it will call `http://api:3000/tweets/{username}`.
    *   For a `search` job, it will call `http://api:3000/search?q={query}`.
3.  **Data Handling:** The monitor will fetch the JSON data from the `api` service and then use the existing `upsertTweet` function to save it to the PostgreSQL database.
4.  **Configuration:** The monitor service will no longer require any `TWITTER_*` environment variables. It will only need the `DATABASE_URL`.

### `docker-compose.yml` (Local Development)

1.  **Remove Credentials from Monitor:** The `monitor` service definition will be updated to remove all `TWITTER_*` environment variables (`TWITTER_USERNAME`, `TWITTER_PASSWORD`, `TWITTER_EMAIL`, `TWITTER_COOKIES`).
2.  **API Credentials:** The `api` service will remain the sole service that contains the `TWITTER_*` credentials, as it is the only one communicating with Twitter.

### `docs/dockge-compose.yaml` (Deployment)

1.  **Remove Credentials from Monitor:** The `twitter-scraper-monitor` service definition will be updated to remove its `environment` block containing the `TWITTER_*` variables.
2.  **API Credentials:** The `twitter-scraper-api` service will retain its `TWITTER_*` environment variables.

---

## 3. Outcome

After these changes:

*   Only the `api` service will log in to Twitter.
*   The `monitor` service will be a simple, lightweight job runner that relies entirely on the `api` service for data.
*   The risk of being flagged for bot-like activity due to multiple logins will be eliminated.
