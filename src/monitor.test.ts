import { processJob } from './monitor';
import { Pool } from 'pg';
import fetch from 'cross-fetch';

// Mock dependencies
jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
    end: jest.fn(),
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('cross-fetch');
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Monitor Service (Refactored)', () => {
  let mockPool: any;
  let mockClient: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    mockPool = new Pool();
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
  });

  test('processJob (profile) calls API and upserts tweets', async () => {
    const job = { job_id: 1, type: 'profile', query: 'elonmusk' };
    const mockTweets = [{ id: '100', text: 'Test Tweet', timestamp: 123456 }];
    
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockTweets }),
    } as any);

    await processJob(job, mockPool);

    // Verify API call
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining('/tweets/elonmusk'));
    
    // Verify DB calls
    // 1. connect
    expect(mockPool.connect).toHaveBeenCalled();
    // 2. upsertTweet (inside processJob)
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tweets'),
      expect.arrayContaining(['100', JSON.stringify(mockTweets[0]), 'profile:elonmusk'])
    );
    // 3. update job status
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs'),
      expect.arrayContaining([1])
    );
    // 4. release
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('processJob (search) calls API and upserts tweets', async () => {
    const job = { job_id: 2, type: 'search', query: 'nodejs' };
    const mockTweets = [{ id: '200', text: 'Search Tweet', timestamp: 123457 }];
    
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockTweets }),
    } as any);

    await processJob(job, mockPool);

    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining('/search?q=nodejs'));
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tweets'),
      expect.arrayContaining(['200', JSON.stringify(mockTweets[0]), 'search:nodejs'])
    );
  });

  test('processJob handles API errors', async () => {
    const job = { job_id: 3, type: 'profile', query: 'error' };
    
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);

    await processJob(job, mockPool);

    // Should update job with shorter retry interval on failure
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs'),
      expect.arrayContaining([3, 15]) // retryMinutes = 15
    );
  });
});
