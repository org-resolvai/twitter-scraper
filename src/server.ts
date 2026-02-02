import express, { Request, Response } from 'express';
import { Scraper, SearchMode } from './scraper';
import { cycleTLSFetch, cycleTLSExit } from './cycletls-fetch';
import "dotenv/config"

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
  await scraper.login(USERNAME as string, PASSWORD as string, EMAIL);
  console.log('Login successful. Starting server...');

  app.use(express.json());

  // ======== API Endpoints ========

  // 1. Fetch User Tweets
  app.get('/tweets/:username', async (req: Request, res: Response) => {
    try {
      const username = req.params.username as string;
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
      const searchGenerator = scraper.searchTweets(query, count, mode as unknown as SearchMode);
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
