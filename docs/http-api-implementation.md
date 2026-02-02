# HTTP API Implementation Guide

This guide provides a step-by-step process for a junior developer to implement the v0 HTTP API server as specified in `docs/http-api.md`. The goal is to create a simple, unauthenticated [Express.js](https://expressjs.com/) server that exposes the core Twitter Scraper functionalities over a REST API.

This server is designed for internal use, such as within a Docker network, and therefore does not include authentication.

## Step 1: Add Dependencies

First, we need to add `express` and its corresponding TypeScript type definitions to the project. Open your terminal in the project root and run the following command:

```bash
yarn add express && yarn add -D @types/express
```

This will update your `package.json` and `yarn.lock` files with the new dependencies.

## Step 2: Create the Server File

Next, create a new file named `server.ts` inside the `src/` directory. This file will contain all the logic for our HTTP server.

```bash
touch src/server.ts
```

Now, open `src/server.ts` and add the following code. This code sets up the server, initializes the `Scraper` instance, and defines the API endpoints.

```typescript
import express, { Request, Response } from 'express';
import { Scraper, Tweet, SearchMode } from './scraper';

// Configuration
const PORT = process.env.PORT || 3000;
const USERNAME = process.env.TWITTER_USERNAME;
const PASSWORD = process.env.TWITTER_PASSWORD;
const EMAIL = process.env.TWITTER_EMAIL;

if (!USERNAME || !PASSWORD) {
  throw new Error(
    'Twitter credentials (TWITTER_USERNAME, TWITTER_PASSWORD) are required in your .env file.',
  );
}

// Helper function to collect results from an AsyncGenerator
async function collectAsyncGenerator<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of generator) {
    results.push(value);
  }
  return results;
}

// Main function to set up and start the server
async function main() {
  const app = express();
  const scraper = new Scraper();

  console.log('Logging into Twitter...');
  await scraper.login(USERNAME, PASSWORD, EMAIL);
  console.log('Login successful. Starting server...');

  app.use(express.json());

  // ======== API Endpoints ========

  // 1. Fetch User Tweets
  app.get('/tweets/:username', async (req: Request, res: Response) => {
    try {
      const username = req.params.username;
      const count = req.query.count ? parseInt(req.query.count as string, 10) : 20;

      if (isNaN(count) || count <= 0) {
        return res.status(400).json({ error: 'Invalid count parameter. Must be a positive number.' });
      }
      
      console.log(`Fetching ${count} tweets for user: ${username}`);
      const tweetsGenerator = scraper.getTweets(username, count);
      const tweets = await collectAsyncGenerator(tweetsGenerator);

      if (tweets.length === 0) {
        // This could mean the user has no tweets or the user does not exist.
        // The core library doesn't distinguish, so we return a 404.
        return res.status(404).json({ error: 'User not found or has no tweets.' });
      }

      res.json({
        meta: {
          count: tweets.length,
          username: username,
        },
        data: tweets,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  // 2. Search Tweets
  app.get('/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const count = req.query.count ? parseInt(req.query.count as string, 10) : 20;
      const mode = (req.query.mode as string) || 'Top';

      if (!query) {
        return res.status(400).json({ error: 'Search query parameter "q" is required.' });
      }
      if (isNaN(count) || count <= 0) {
        return res.status(400).json({ error: 'Invalid count parameter. Must be a positive number.' });
      }
      if (mode !== 'Top' && mode !== 'Latest') {
        return res.status(400).json({ error: 'Invalid mode parameter. Must be "Top" or "Latest".' });
      }
      
      console.log(`Searching for "${query}" (mode: ${mode}, count: ${count})`);
      const searchGenerator = scraper.searchTweets(query, count, mode as SearchMode);
      const searchResults = await collectAsyncGenerator(searchGenerator);

      res.json({
        meta: {
          query: query,
          count: searchResults.length,
          mode: mode,
        },
        data: searchResults,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  // ======== Server Start ========

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

// Run the main function and handle any top-level errors
main().catch((err) => {
  console.error('Failed to start the server:', err);
  process.exit(1);
});
```

## Step 3: Add Build and Start Scripts

To make it easy to build and run our new server, we need to add scripts to the `package.json` file. We will follow the pattern used by `build:monitor`.

Open `package.json` and add the following two lines to the `"scripts"` section:

```json
    "build:server": "esbuild src/server.ts --bundle --platform=node --target=node16 --outfile=dist/server.js --external:pg --external:tough-cookie --external:cycletls --define:PLATFORM_NODE=true",
    "server": "node dist/server.js",
```

The `"scripts"` section should now look something like this:

```json
  "scripts": {
    "build": "rimraf dist && rollup -c",
    "build:monitor": "esbuild src/monitor.ts --bundle --platform=node --target=node16 --outfile=dist/monitor.js --external:pg --external:tough-cookie --external:cycletls --define:PLATFORM_NODE=true",
    "build:server": "esbuild src/server.ts --bundle --platform=node --target=node16 --outfile=dist/server.js --external:pg --external:tough-cookie --external:cycletls --define:PLATFORM_NODE=true",
    "monitor": "node dist/monitor.js",
    "server": "node dist/server.js",
    "commit": "cz",
    "docs:generate": "typedoc --options typedoc.json",
    // ... other scripts
  },
```

## Step 4: Configure Environment Variables

The server requires your Twitter credentials to log in. Create a file named `.env` in the root of the project if it doesn't already exist.

```bash
touch .env
```

Add your credentials to the `.env` file:

```
# .env file
TWITTER_USERNAME="your_username"
TWITTER_PASSWORD="your_password"

# Optional: sometimes email is needed for login verification
# TWITTER_EMAIL="your_email@example.com"
```

**Note:** The `.env` file is listed in `.gitignore`, so your credentials will not be committed to git.

## Step 5: Run the Server

Now you are ready to build and run the server.

1.  **Build the server code:**
    ```bash
    yarn build:server
    ```
    This command will compile `src/server.ts` into a single JavaScript file at `dist/server.js`.

2.  **Start the server:**
    ```bash
    yarn server
    ```

You should see output indicating that the server is logging in and has started successfully:

```
$ node dist/server.js
Logging into Twitter...
Login successful. Starting server...
Server is running at http://localhost:3000
```

## Step 6: Verify the API

You can now test your API endpoints using a tool like `curl` or by visiting the URLs in your browser.

### Test User Tweets Endpoint

To get the 5 latest tweets from the user `elonmusk`:

```bash
curl "http://localhost:3000/tweets/elonmusk?count=5"
```

### Test Search Endpoint

To search for the 10 latest tweets matching the query "nodejs":

```bash
curl "http://localhost:3000/search?q=nodejs&count=10&mode=Latest"
```

You have now successfully implemented the HTTP API server.
