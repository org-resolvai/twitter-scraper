import express, { Request, Response } from 'express';
import { TwitterApi, TweetV2, ApiV2Includes } from 'twitter-api-v2';
import "dotenv/config";
import { Tweet, Mention, Photo, Video } from './tweets';

export const app = express();

app.use(express.json());

// Initialize Twitter Client
// Priority: Bearer Token (App-only) -> OAuth 1.0a (User Context)
let client: TwitterApi;

if (process.env.TWITTER_BEARER_TOKEN) {
  client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
} else {
  client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY || '',
    appSecret: process.env.TWITTER_API_SECRET || '',
    accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
    accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
  });
}

// Use readOnly client for safer operations
const twitterClient = client.readOnly;

// Helper: Map TweetV2 to internal Tweet interface
function mapTweet(tweet: TweetV2, includes?: ApiV2Includes): Tweet {
  const author = includes?.users?.find(u => u.id === tweet.author_id);
  const mediaKeys = tweet.attachments?.media_keys || [];
  const medias = includes?.media?.filter(m => mediaKeys.includes(m.media_key)) || [];

  const photos: Photo[] = [];
  const videos: Video[] = [];

  medias.forEach(m => {
    if (m.type === 'photo' && m.url) {
      photos.push({ id: m.media_key, url: m.url, alt_text: m.alt_text });
    } else if ((m.type === 'video' || m.type === 'animated_gif') && (m.preview_image_url || m.url)) { // m.url is sometimes variant url
       // API v2 doesn't always give direct video URLs in the basic object, 
       // but we map what we can. 
       videos.push({ 
         id: m.media_key, 
         preview: m.preview_image_url || '', 
         url: m.url 
       });
    }
  });

  return {
    id: tweet.id,
    text: tweet.text,
    username: author?.username,
    userId: tweet.author_id,
    name: author?.name,
    timestamp: tweet.created_at ? new Date(tweet.created_at).getTime() / 1000 : undefined,
    timeParsed: tweet.created_at ? new Date(tweet.created_at) : undefined,
    likes: tweet.public_metrics?.like_count,
    retweets: tweet.public_metrics?.retweet_count,
    replies: tweet.public_metrics?.reply_count,
    views: tweet.public_metrics?.impression_count as number | undefined,
    photos,
    videos,
    hashtags: tweet.entities?.hashtags?.map(h => h.tag) || [],
    urls: tweet.entities?.urls?.map(u => u.expanded_url) || [],
    mentions: tweet.entities?.mentions?.map(m => ({
      id: m.id,
      username: m.username,
    })) || [],
    thread: [], // Thread reconstruction is complex, leaving empty for now
    html: undefined, 
    permanentUrl: `https://twitter.com/${author?.username || 'i'}/status/${tweet.id}`,
    sensitiveContent: tweet.possibly_sensitive
  };
}

// 1. GET /tweets/:username
app.get('/tweets/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username as string;
    const count = parseInt(req.query.count as string) || 20;

    // Step 1: Get User ID
    const user = await twitterClient.v2.userByUsername(username);

    if (!user.data) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Step 2: Get Timeline
    const timeline = await twitterClient.v2.userTimeline(user.data.id, {
      max_results: Math.max(10, Math.min(count, 100)), // API v2 limit is 10-100
      'tweet.fields': [
        'created_at', 
        'public_metrics', 
        'entities', 
        'possibly_sensitive',
        'author_id',
        'attachments'
      ],
      expansions: [
        'author_id',
        'attachments.media_keys'
      ],
      'media.fields': [
        'url',
        'preview_image_url',
        'type',
        'alt_text'
      ],
      'user.fields': ['username', 'name']
    });

    const tweets = timeline.data.data?.map(t => mapTweet(t, timeline.data.includes)) || [];

    res.json({
      meta: {
        count: tweets.length,
        username: username,
      },
      data: tweets,
    });

  } catch (err) {
    console.error('Error fetching tweets:', err);
    res.status(500).json({ error: 'Internal API Error' });
  }
});

// 2. GET /search
app.get('/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const count = parseInt(req.query.count as string) || 20;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const search = await twitterClient.v2.search(query, {
      max_results: Math.max(10, Math.min(count, 100)),
      sort_order: 'recency', // Mimic 'Latest' / reverse-chronological
      'tweet.fields': [
        'created_at', 
        'public_metrics', 
        'entities', 
        'possibly_sensitive',
        'author_id',
        'attachments'
      ],
      expansions: [
        'author_id',
        'attachments.media_keys'
      ],
      'media.fields': [
        'url',
        'preview_image_url',
        'type',
        'alt_text'
      ],
      'user.fields': ['username', 'name']
    });

    const tweets = search.data.data?.map(t => mapTweet(t, search.data.includes)) || [];

    res.json({
      meta: {
        query: query,
        count: tweets.length,
      },
      data: tweets,
    });

  } catch (err) {
    console.error('Error searching tweets:', err);
    res.status(500).json({ error: 'Internal API Error' });
  }
});

const PORT = process.env.PORT || 3000;

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`Official API Server running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}
