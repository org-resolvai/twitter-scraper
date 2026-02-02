# HTTP API Specification

This document describes the specification for the HTTP API server component of the Twitter Scraper. This API provides a RESTful interface to fetch tweets and search results in real-time without persistent storage.

## Overview

The API is built using `express` and uses the core `Scraper` class to interact with Twitter's frontend API. It is designed to be lightweight and stateless.

## Prerequisites

*   Node.js v16+

## Installation

To enable the API server, you must install the required dependencies:

```bash
yarn add express
yarn add -D @types/express
```

## Configuration

The server automatically uses the existing Twitter credentials configured for the project (via `.env` or environment variables).

| Variable | Description | Required |
| :--- | :--- | :--- |
| `PORT` | Server port (default: 3000) | No |
| `TWITTER_USERNAME` | (Existing) | Yes |
| `TWITTER_PASSWORD` | (Existing) | Yes |

No additional authentication parameters are needed for the API server itself.

## API Endpoints

### 1. Fetch User Tweets

Retrieves the latest tweets from a specific user's timeline.

*   **Endpoint:** `GET /tweets/:username`
*   **Method:** `GET`
*   **URL Parameters:**
    *   `username` (string): The Twitter handle (without @).
*   **Query Parameters:**
    *   `count` (number, optional): Number of tweets to fetch. Default: 20. Max: 100.

#### Example Request

```http
GET /tweets/elonmusk?count=5
```

#### Example Response (200 OK)

```json
{
  "meta": {
    "count": 5,
    "username": "elonmusk"
  },
  "data": [
    {
      "id": "1234567890",
      "text": "Hello Mars!",
      "timestamp": 1677654321,
      "likes": 5000,
      "retweets": 1000,
      "photos": [],
      "videos": []
    }
    // ... more tweets
  ]
}
```

### 2. Search Tweets

Performs a search query.

*   **Endpoint:** `GET /search`
*   **Method:** `GET`
*   **Query Parameters:**
    *   `q` (string, required): The search query.
    *   `count` (number, optional): Number of results. Default: 20.
    *   `mode` (string, optional): Search mode. `Top` (default) or `Latest`.

#### Example Request

```http
GET /search?q=nodejs&mode=Latest
```

## Error Handling

The API returns standard HTTP status codes:

*   `200 OK`: Request successful.
*   `400 Bad Request`: Missing required parameters.
*   `404 Not Found`: User or resource not found.
*   `429 Too Many Requests`: Rate limit exceeded.
*   `500 Internal Server Error`: Scraper error.

## Running the Server

(Pending Implementation)

The server entry point will be located at `src/server.ts`.

```bash
# Development
yarn ts-node src/server.ts

# Production (after build)
node dist/server.js
```
