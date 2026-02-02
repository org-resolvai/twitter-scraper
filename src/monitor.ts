import { Pool } from 'pg';
import { Scraper } from './scraper';
import { Tweet } from './tweets';
import { SearchMode } from './search';
import { cycleTLSFetch, cycleTLSExit } from './cycletls-fetch';
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

export async function processJob(scraper: Scraper, job: any, poolInstance: Pool = pool) {
  const client = await poolInstance.connect();
  try {
    console.log(`[Job ${job.job_id}] Starting ${job.type}: ${job.query}`);
    
    let count = 0;
    const criteriaTag = `${job.type}:${job.query}`;

    if (job.type === 'profile') {
      const iterator = scraper.getTweets(job.query, 20);
      for await (const tweet of iterator) {
        await upsertTweet(tweet, criteriaTag, client);
        count++;
      }
    } else if (job.type === 'search') {
      const iterator = scraper.searchTweets(job.query, 20, SearchMode.Top);
      for await (const tweet of iterator) {
        await upsertTweet(tweet, criteriaTag, client);
        count++;
      }
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
    // On failure, retry sooner? Or same schedule? 
    // For now, let's stick to the schedule to avoid loops, or maybe retry in 15 mins.
    // Let's use a shorter fixed retry of 15 mins on failure.
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
  // Initialize Scraper with CycleTLS
  // Note: xClientTransactionId requires Node.js 22+ (ArrayBuffer.transfer)
  const scraper = new Scraper({
    fetch: cycleTLSFetch,
    experimental: {
      xClientTransactionId: true,
      xpff: true,
    },
  });

  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;
  const email = process.env.TWITTER_EMAIL;
  const cookies = process.env.TWITTER_COOKIES;

  try {
    // Prefer cookie auth (more reliable), fall back to password
    if (cookies) {
      console.log('Authenticating with cookies...');
      const parsedCookies = JSON.parse(cookies) as Array<{
        key: string;
        value: string;
        domain?: string;
        path?: string;
      }>;
      const cookieStrings = parsedCookies.map(
        (c) => `${c.key}=${c.value}; Domain=${c.domain || '.x.com'}; Path=${c.path || '/'}`
      );
      await scraper.setCookies(cookieStrings);
      console.log('Authenticated with cookies.');
    } else if (username && password) {
      console.log('Logging in with username/password...');
      await scraper.login(username, password, email);
      console.log('Logged in successfully.');
    } else {
      console.error('Missing TWITTER_COOKIES or TWITTER_USERNAME/TWITTER_PASSWORD in environment');
      process.exit(1);
    }

    while (true) {
      const client = await poolInstance.connect();
      let jobs = [];
      try {
        // Fetch due jobs based on next_run_at
        // If next_run_at is NULL, it runs immediately (first run)
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
        await processJob(scraper, job, poolInstance);
        
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
    cycleTLSExit();
    process.exit(1);
  }
}

import { fileURLToPath } from 'url';

// ... (rest of imports)

// ... (functions)

runMonitor();

