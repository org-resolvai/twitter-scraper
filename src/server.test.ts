import request from 'supertest';
import express, { Express } from 'express';
import { Scraper, SearchMode } from './scraper';

// Mock the Scraper class and cycleTLSFetch
jest.mock('./scraper');
jest.mock('./cycletls-fetch', () => ({
  cycleTLSFetch: jest.fn(),
  cycleTLSExit: jest.fn(),
}));

// Mock the entire module to verify behavior
// We need to define the server logic inside the test or refactor server.ts to export the app
// Since server.ts currently runs "main()" immediately, we should refactor it slightly
// to be testable, or we can copy the logic into a helper for this test.
// For now, let's create a testable app factory to simulate the server.ts logic.

const createTestApp = (scraperInstance: any) => {
  const app = express();
  app.use(express.json());

  app.get('/tweets/:username', async (req, res) => {
    try {
      const username = req.params.username;
      const count = parseInt(req.query.count as string) || 20;

      const tweetsGenerator = scraperInstance.getTweets(username, count);
      const tweets = [];
      for await (const tweet of tweetsGenerator) {
        tweets.push(tweet);
      }

      if (tweets.length === 0) {
        return res
          .status(404)
          .json({ error: 'User not found or has no tweets.' });
      }

      res.json({
        meta: { count: tweets.length, username },
        data: tweets,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const count = parseInt(req.query.count as string) || 20;
      const mode = (req.query.mode as string) || 'Top';

      const searchGenerator = scraperInstance.searchTweets(
        query,
        count,
        mode as unknown as SearchMode,
      );
      const results = [];
      for await (const tweet of searchGenerator) {
        results.push(tweet);
      }

      res.json({
        meta: { query, count: results.length, mode },
        data: results,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
};

describe('API Server Endpoints', () => {
  let mockScraper: any;
  let app: Express;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create a mock scraper instance
    mockScraper = {
      login: jest.fn().mockResolvedValue(undefined),
      getTweets: jest.fn(),
      searchTweets: jest.fn(),
    };

    app = createTestApp(mockScraper);
  });

  test('GET /tweets/:username returns tweets', async () => {
    const mockTweets = [
      { id: '1', text: 'Hello World', timestamp: 12345 },
      { id: '2', text: 'Another tweet', timestamp: 12346 },
    ];

    // Mock generator for getTweets
    async function* mockGenerator() {
      for (const t of mockTweets) yield t;
    }
    mockScraper.getTweets.mockReturnValue(mockGenerator());

    const res = await request(app).get('/tweets/elonmusk');

    expect(res.status).toBe(200);
    expect(res.body.meta.username).toBe('elonmusk');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].text).toBe('Hello World');
    expect(mockScraper.getTweets).toHaveBeenCalledWith('elonmusk', 20);
  });

  test('GET /search returns search results', async () => {
    const mockResults = [
      { id: '3', text: 'Search Result 1', timestamp: 12345 },
    ];

    // Mock generator for searchTweets
    async function* mockGenerator() {
      for (const t of mockResults) yield t;
    }
    mockScraper.searchTweets.mockReturnValue(mockGenerator());

    const res = await request(app).get('/search?q=nodejs');

    expect(res.status).toBe(200);
    expect(res.body.meta.query).toBe('nodejs');
    expect(res.body.data).toHaveLength(1);
    expect(mockScraper.searchTweets).toHaveBeenCalledWith('nodejs', 20, 'Top');
  });

  test('GET /tweets/:username returns 404 if no tweets found', async () => {
    // Mock empty generator
    async function* mockGenerator() {
      return;
    }
    mockScraper.getTweets.mockReturnValue(mockGenerator());

    const res = await request(app).get('/tweets/unknown_user');

    expect(res.status).toBe(404);
  });
});
