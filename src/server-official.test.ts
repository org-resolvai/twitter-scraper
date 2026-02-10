import request from 'supertest';
import { app } from './server-official';
import { TwitterApi } from 'twitter-api-v2';

// Mock the TwitterApi class
jest.mock('twitter-api-v2', () => {
  const mockV2Client = {
    userByUsername: jest.fn(),
    userTimeline: jest.fn(),
    search: jest.fn(),
  };
  
  return {
    TwitterApi: jest.fn().mockImplementation(() => {
      return {
        v2: mockV2Client,
        readOnly: { v2: mockV2Client } // In case readOnly is used
      };
    })
  };
});

describe('Official API Server', () => {
  let mockV2: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-ignore
    const client = new TwitterApi();
    mockV2 = client.v2;
  });

  test('GET /tweets/:username should return mapped tweets', async () => {
    // 1. Mock ID lookup
    mockV2.userByUsername.mockResolvedValue({
      data: { id: '12345', username: 'testuser' }
    });

    // 2. Mock Timeline response
    mockV2.userTimeline.mockResolvedValue({
      data: {
        data: [
          {
            id: 'tweet-1',
            text: 'Hello World',
            author_id: '12345',
            created_at: '2023-01-01T12:00:00.000Z',
            public_metrics: {
              like_count: 10,
              retweet_count: 5,
              reply_count: 1,
              impression_count: 100
            }
          }
        ],
        includes: {
          users: [
            { id: '12345', username: 'testuser' }
          ]
        },
        meta: { result_count: 1 }
      }
    });

    const res = await request(app).get('/tweets/testuser');

    expect(res.status).toBe(200);
    expect(res.body.meta.username).toBe('testuser');
    expect(res.body.data).toHaveLength(1);
    
    const tweet = res.body.data[0];
    expect(tweet.id).toBe('tweet-1');
    expect(tweet.text).toBe('Hello World');
    expect(tweet.username).toBe('testuser');
    expect(tweet.likes).toBe(10);
    expect(tweet.retweets).toBe(5);
    expect(tweet.views).toBe(100);
  });

  test('GET /search should return mapped search results', async () => {
    mockV2.search.mockResolvedValue({
      data: {
        data: [
          {
            id: 'tweet-2',
            text: 'Search Result',
            author_id: '999',
            created_at: '2023-01-02T12:00:00.000Z',
            public_metrics: {
              like_count: 0,
              retweet_count: 0,
              reply_count: 0,
              impression_count: 0
            }
          }
        ],
        includes: {
          users: [
            { id: '999', username: 'otheruser' }
          ]
        },
        meta: { result_count: 1 }
      }
    });

    const res = await request(app).get('/search?q=test');

    expect(res.status).toBe(200);
    expect(res.body.meta.query).toBe('test');
    expect(res.body.data).toHaveLength(1);

    const tweet = res.body.data[0];
    expect(tweet.id).toBe('tweet-2');
    expect(tweet.username).toBe('otheruser');
  });

  test('GET /tweets/:username should return 404 if user not found', async () => {
    // Mock user lookup failing (or returning undefined data)
    mockV2.userByUsername.mockResolvedValue({
      data: undefined
    });

    const res = await request(app).get('/tweets/unknown');
    expect(res.status).toBe(404);
  });
});
