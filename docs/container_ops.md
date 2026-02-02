# Container Operations

This document details the process and findings from containerizing the `twitter-scraper` repository.

## Containerization Process

The repository has been successfully containerized to facilitate reproducible builds and testing environments.

### Dockerfile

A `Dockerfile` was created in the project root.

**Key Decisions:**
*   **Base Image:** `node:20-slim`.
    *   *Initial Attempt:* `node:20-alpine` was initially tried but caused compatibility issues with `esbuild` on ARM64 architectures. Switching to the `slim` variant resolved this.
*   **Package Management:** `corepack enable` is used to manage Yarn versions as specified in `package.json`.

### Building the Image

To build the container image (using Podman):

```bash
podman build -t twitter-scraper .
```

## Running Tests

The default command for the container is configured to run the project's test suite (`yarn test`).

### Execution Command

```bash
podman run --rm twitter-scraper
```

### Test Findings

During the initial run, the following behaviors were observed:

1.  **Missing Credentials**: The majority of tests failed as expected because they require valid Twitter credentials.
    *   Error: `TWITTER_USERNAME and TWITTER_PASSWORD variables must be defined.`
2.  **Anonymous Scraping**: Tests attempting anonymous scraping (without login) failed with network errors.
    *   Error: `Failed to fetch X homepage`.
    *   *Cause:* likely due to Twitter/X blocking requests from Data Center IP addresses or requiring a proxy.

### Running with Credentials

To run the tests successfully, you must inject the required environment variables into the container.

**Using an `.env.local` file (Recommended):**

1.  Create a `.env.local` file in the project root:
    ```bash
    TWITTER_USERNAME=your_username
    TWITTER_PASSWORD=your_password
    TWITTER_EMAIL=your_email
    # Note: Do NOT use outer quotes for the JSON string if using podman --env-file
    TWITTER_COOKIES=[{"key":"auth_token","value":"...","domain":".x.com","path":"/"},{"key":"ct0","value":"...","domain":".x.com","path":"/"},{"key":"twid","value":"...","domain":".x.com","path":"/"}]
    ```
2.  Run with Podman:
    ```bash
    podman run --rm --env-file .env.local twitter-scraper
    ```

#### Retrieving Cookies (CRITICAL STEPS)

The `TWITTER_COOKIES` variable requires a specific JSON format containing the `auth_token` and `ct0` cookies.

1.  **Log in** to Twitter/X in your browser.
2.  Open **Developer Tools** (F12) -> **Application** (Chrome) / **Storage** (Firefox) -> **Cookies** -> `https://x.com`.
3.  Locate `auth_token`, `ct0`, and optionally `twid`.
4.  Construct a JSON array.
    *   **Field Name:** Use `"key"` (not `"name"`).
    *   **Domain:** Use `".x.com"` (with leading dot). **Do NOT use `.twitter.com`**.
    *   **Format:**
        ```json
        [
          {
            "key": "auth_token",
            "value": "YOUR_AUTH_TOKEN_VALUE",
            "domain": ".x.com",
            "path": "/"
          },
          {
            "key": "ct0",
            "value": "YOUR_CT0_VALUE",
            "domain": ".x.com",
            "path": "/"
          },
          {
            "key": "twid",
            "value": "YOUR_TWID_VALUE",
            "domain": ".x.com",
            "path": "/"
          }
        ]
        ```

#### Cookie Format Notes

The test utilities convert the JSON cookie objects to cookie strings internally. The required fields are:
- `key`: The cookie name (e.g., `auth_token`, `ct0`, `twid`)
- `value`: The cookie value
- `domain`: Should be `.x.com`
- `path`: Should be `/`

Additional fields like `secure`, `httpOnly`, `sameSite` are optional and will be ignored.

*Note: Ensure you handle your credentials securely. The `.env.local` file has been added to `.gitignore`.*

## Running the Monitor (Docker Compose)

```bash
# Start the monitor and postgres
docker compose up

# Rebuild after code changes
docker compose build --no-cache
docker compose up

# Stop and remove containers
docker compose down

# Stop and remove containers + delete data volume
docker compose down -v
```

## Database Management

Connect to postgres:
```bash
docker compose exec postgres psql -U postgres -d twitter
```

View jobs:
```sql
SELECT * FROM jobs;
```

Add a new profile job:
```sql
INSERT INTO jobs (type, query, interval_minutes) VALUES ('profile', 'username', 15);
```

Add a new search job:
```sql
INSERT INTO jobs (type, query, interval_minutes) VALUES ('search', 'keyword', 15);
```

Disable a job:
```sql
UPDATE jobs SET active = false WHERE query = 'username';
```

## Troubleshooting

### 404 Errors on Search or Profile Requests

Twitter/X frequently rotates their GraphQL endpoint hashes. If you see 404 errors like:

```
Response status: 404 | headers: "..." | data:
```

The endpoint hash in `src/api-data.ts` is stale and needs to be updated.

**To fix:**

1. Open Twitter/X in your browser with DevTools Network tab open (F12 > Network)
2. Perform the action that's failing:
   - For search: search for any term
   - For profiles: visit a user profile
3. Filter network requests by `graphql`
4. Find the request matching the failing endpoint (e.g., `SearchTimeline`, `UserTweets`, `UserByScreenName`)
5. Copy the new endpoint URL - it will look like:
   ```
   /i/api/graphql/NEW_HASH_HERE/SearchTimeline?variables=...
   ```
6. Update the corresponding entry in `src/api-data.ts` with the new URL
7. Rebuild:
   ```bash
   yarn build
   yarn build:monitor
   docker compose build --no-cache
   docker compose up
   ```

**Endpoint mapping:**

| Error Context | Endpoint in api-data.ts |
|---------------|------------------------|
| Search tweets | `SearchTimeline` |
| User profiles | `UserByScreenName` |
| User tweets | `UserTweets` |
| Followers | `Followers` |
| Following | `Following` |

### PLATFORM_NODE is not defined

If you see:
```
ReferenceError: PLATFORM_NODE is not defined
```

The `build:monitor` script is missing the define flag. Ensure `package.json` has:
```json
"build:monitor": "esbuild src/monitor.ts --bundle --platform=node --target=node16 --outfile=dist/monitor.js --external:pg --external:tough-cookie --external:cycletls --define:PLATFORM_NODE=true"
```

### Database Connection Issues

If the monitor can't connect to postgres, check:
1. The `postgres` service is running: `docker compose ps`
2. Environment variables match between services in `docker-compose.yml`
3. The `depends_on` ensures postgres starts first

### Rate Limiting

Twitter has rate limits. If you're getting rate limited:
- Increase `interval_minutes` for jobs
- Reduce the number of active jobs
- Check the `x-rate-limit-remaining` header in error responses
