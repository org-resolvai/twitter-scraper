import { Pool } from 'pg';
import { Tweet } from './tweets';
import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper to pause execution
export const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function upsertTweet(tweet: Tweet, criteria: string, client: any) {
  try {
    const tweetId = tweet.id;
    const body = JSON.stringify(tweet);
    
    // Check if 'timeParsed' is available, fallback to timestamp
    const createdAt = tweet.timeParsed 
      ? tweet.timeParsed 
      : (tweet.timestamp ? new Date(tweet.timestamp * 1000) : null); 

    const query = `
      INSERT INTO tweets (tweet_id, body, criteria, created_at, scraped_at)
      VALUES ($1, $2::jsonb, jsonb_build_array($3::text), $4, NOW())
      ON CONFLICT (tweet_id) 
      DO UPDATE SET
        criteria = (
          SELECT jsonb_agg(DISTINCT elems)
          FROM jsonb_array_elements(tweets.criteria || jsonb_build_array($3::text)) elems
        ),
        scraped_at = NOW();
    `;

    await client.query(query, [tweetId, body, criteria, createdAt]);
  } catch (err) {
    console.error(`Failed to upsert tweet ${tweet.id}:`, err);
  }
}

export async function processJob(job: any, poolInstance: Pool = pool) {
  const client = await poolInstance.connect();
  try {
    console.log(`[Job ${job.job_id}] Starting ${job.type}: ${job.query}`);
    
    let count = 0;
    const criteriaTag = `${job.type}:${job.query}`;
    
    const API_URL = process.env.API_URL || 'http://localhost:3000';
    let results: Tweet[] = [];

    if (job.type === 'profile') {
      console.log(`[Job ${job.job_id}] Fetching tweets from API: ${API_URL}/tweets/${job.query}`);
      const response = await fetch(`${API_URL}/tweets/${job.query}?count=20`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      results = json.data || [];
    } else if (job.type === 'search') {
      console.log(`[Job ${job.job_id}] Fetching search from API: ${API_URL}/search?q=${job.query}`);
      const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(job.query)}&count=20&mode=Top`);
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      results = json.data || [];
    }

    for (const tweet of results) {
      await upsertTweet(tweet, criteriaTag, client);
      count++;
    }

    console.log(`[Job ${job.job_id}] Finished. Upserted ${count} tweets.`);

    // Calculate next run time: Random between 1 hour (60 mins) and 2 hours (120 mins)
    const nextIntervalMinutes = Math.floor(Math.random() * 60) + 60;
    
    // Update last_run_at and next_run_at
    await client.query(`
      UPDATE jobs 
      SET last_run_at = NOW(),
          next_run_at = NOW() + ($2 || ' minutes')::interval
      WHERE job_id = $1
    `, [job.job_id, nextIntervalMinutes]);
    
    console.log(`[Job ${job.job_id}] Rescheduled in ${nextIntervalMinutes} minutes.`);

  } catch (err) {
    console.error(`[Job ${job.job_id}] Failed:`, err);
    // On failure, retry in 15 mins.
    const retryMinutes = 15;
    await client.query(`
      UPDATE jobs 
      SET last_run_at = NOW(),
          next_run_at = NOW() + ($2 || ' minutes')::interval
      WHERE job_id = $1
    `, [job.job_id, retryMinutes]);
  } finally {
    client.release();
  }
}

export async function runMonitor(poolInstance: Pool = pool) {
  console.log('Monitor service started. Connecting to API for data...');

  try {
    while (true) {
      const client = await poolInstance.connect();
      let jobs = [];
      try {
        // Fetch due jobs based on next_run_at
        const res = await client.query(`
          SELECT * FROM jobs 
          WHERE active = true 
          AND (next_run_at IS NULL OR next_run_at <= NOW())
          ORDER BY next_run_at ASC NULLS FIRST
          LIMIT 1
        `);
        jobs = res.rows;
      } finally {
        client.release();
      }

      if (jobs.length > 0) {
        const job = jobs[0];
        await processJob(job, poolInstance);
        
        // Cool down: Sleep between 5 and 30 seconds
        const sleepTime = Math.floor(Math.random() * 25000) + 5000;
        console.log(`Job finished. Sleeping for ${Math.floor(sleepTime / 1000)} seconds...`);
        await sleepMs(sleepTime); 
      } else {
        // Idle sleep: Between 10 and 15 minutes
        const sleepTime = Math.floor(Math.random() * 300000) + 600000;
        console.log(`No jobs due. Sleeping for ${Math.floor(sleepTime / 1000)} seconds...`);
        await sleepMs(sleepTime);
      }
    }

  } catch (err) {
    console.error('Fatal error in monitor:', err);
    await poolInstance.end();
    process.exit(1);
  }
}

/**
 * Run the monitor if this file is executed directly.
 */
if (typeof require !== 'undefined' && require.main === module) {
  runMonitor();
}
