# Official API Server Specification

## Goal
Create a drop-in replacement for the existing `src/server.ts` that fulfills the contract expected by the monitoring service (`src/monitor.ts`) but uses the official Twitter API v2 instead of the internal scraping logic.

## Architecture

*   **Server Framework:** `express` (consistent with existing `src/server.ts`).
*   **Twitter Client:** `twitter-api-v2` library.
    *   *Reasoning:* Provides robust typing for API v2 responses, handles rate limit headers automatically, and simplifies the complex "expansions" logic needed to reconstruct tweets (resolving user IDs to usernames, media keys to URLs).

## Environment Variables

The server will require a new set of credentials in `.env` to authenticate with the official API:

```env
# Official API Credentials
# Method A: Bearer Token (App-only auth, higher rate limits for search)
TWITTER_BEARER_TOKEN=your_bearer_token

# Method B: OAuth 1.0a (User context, required for some endpoints)
TWITTER_API_KEY=your_consumer_key
TWITTER_API_SECRET=your_consumer_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_token_secret
```

## API Endpoints (Contract Match)

These endpoints must return JSON in the format `{ data: Tweet[], meta: any }` to satisfy the `monitor.ts` service.

### 1. `GET /tweets/:username`
*   **Logic:**
    1.  Lookup user ID by username (`v2.userByUsername`).
    2.  Fetch timeline (`v2.userTimeline`).
    3.  Map response to `Tweet` interface.
*   **Params:**
    *   `count` (default: 20, max: 100 for API v2).
*   **Response:**
    ```json
    {
      "meta": { "count": 20, "username": "elonmusk" },
      "data": [ { ...Tweet Object... } ]
    }
    ```

### 2. `GET /search`
*   **Logic:**
    1.  Search recent tweets (`v2.search`).
    2.  Map response to `Tweet` interface.
*   **Params:**
    *   `q` (query string).
    *   `count` (default: 20, max: 100).
    *   `mode` (ignored; API v2 `recent` search returns reverse-chronological).
*   **Response:**
    ```json
    {
      "meta": { "query": "nodejs", "count": 20 },
      "data": [ { ...Tweet Object... } ]
    }
    ```

## Data Mapping

The `monitor.ts` service relies on specific fields in the `Tweet` interface (defined in `src/tweets.ts`). We must map API v2 data to this structure:

| `src/tweets.ts` (Tweet) | Twitter API v2 Field | Notes |
| :--- | :--- | :--- |
| `id` | `data.id` | Direct map |
| `text` | `data.text` | Direct map |
| `username` | `includes.users[].username` | Requires `expansions=author_id` |
| `userId` | `data.author_id` | Direct map |
| `timestamp` | `data.created_at` (to unix) | Requires `tweet.fields=created_at` |
| `timeParsed` | `data.created_at` (to Date) | |
| `photos`/`videos` | `includes.media[]` | Requires `expansions=attachments.media_keys` and `media.fields=url,preview_image_url` |
| `likes` | `public_metrics.like_count` | Requires `tweet.fields=public_metrics` |
| `retweets` | `public_metrics.retweet_count` | |
| `replies` | `public_metrics.reply_count` | |
| `views` | `public_metrics.impression_count`| |

## Implementation Plan

1.  **Install Dependency:**
    ```bash
    yarn add twitter-api-v2
    ```

2.  **Create Server File:**
    *   Create `src/server-official.ts`.
    *   Implement the Express app and endpoints.
    *   Implement the mapping logic from `TwitterV2` types to `Tweet` interface.

3.  **Build Configuration:**
    *   Update `package.json` scripts:
        ```json
        "build:server-official": "esbuild src/server-official.ts --bundle --platform=node --target=node16 --outfile=dist/server-official.js --external:twitter-api-v2 --external:express --define:PLATFORM_NODE=true",
        "server:official": "node dist/server-official.js"
        ```

4.  **Verification:**
    *   Run `yarn server:official` with valid credentials.
    *   Test endpoints with `curl` to ensure output format matches the existing scraper.
