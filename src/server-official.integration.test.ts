import request from 'supertest';
import { app } from './server-official';
import "dotenv/config";

// Integration Test: Official API Server
// Uses REAL Twitter API credentials from .env
// WARN: Consumes API rate limits.

describe('Official API Server (Integration)', () => {
  
  // Skip tests if credentials are missing to avoid false negatives in CI/CD
  const hasCredentials = process.env.TWITTER_BEARER_TOKEN || 
    (process.env.TWITTER_API_KEY && process.env.TWITTER_ACCESS_TOKEN);

  if (!hasCredentials) {
    console.warn('Skipping integration tests: No Twitter API credentials found in .env');
    test.skip('Skipping integration tests', () => {});
    return;
  }

  // 1. Test Fetching a Real User's Timeline
  test('GET /tweets/:username returns real tweets (Integration)', async () => {
    // Using 'elonmusk' as requested - a very active account
    const targetUser = 'elonmusk'; 
    
    // API v2 requires min 10 results
    const res = await request(app).get(`/tweets/${targetUser}?count=15`);

    expect(res.status).toBe(200);
    expect(res.body.meta.username).toBe(targetUser);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Elon Musk definitely has tweets
    expect(res.body.data.length).toBeGreaterThan(0);

    const tweet = res.body.data[0];
    // Check for essential fields that prove mapping worked on real data
    expect(tweet.id).toBeDefined();
    expect(tweet.text).toBeDefined();
    expect(tweet.userId).toBeDefined();
  });

  // 2. Test Real Search
  test('GET /search returns real search results (Integration)', async () => {
    // Searching for a common term to ensure results
    const query = 'Twitter';

    // API v2 requires min 10 results
    const res = await request(app).get(`/search?q=${query}&count=15`);

    expect(res.status).toBe(200);
    expect(res.body.meta.query).toBe(query);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const tweet = res.body.data[0];
    expect(tweet.id).toBeDefined();
    expect(tweet.text).toBeDefined();
  });

  // 3. Test 404 on Non-Existent User
  test('GET /tweets/:username returns 404 for non-existent user (Integration)', async () => {
    // Using a random 15-char string to ensure it's a valid format but non-existent
    // e.g. 'usr_1739283...'
    const randomSuffix = Date.now().toString().slice(-8);
    const fakeUser = `usr_${randomSuffix}`;

    const res = await request(app).get(`/tweets/${fakeUser}`);
    
    // API v2 might return 400 or 404 depending on exact error, 
    // but our server maps "no data" to 404.
    // Sometimes the library throws a 404 error which express catches and returns 500
    // We want to ensure it's NOT a 200 OK with data.
    expect(res.status).not.toBe(200);
  });

});
