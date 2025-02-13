# Stremio IPTV Addon with DRM Support

A versatile Stremio addon that allows you to watch your IPTV channels directly in Stremio. This addon supports M3U playlists, DASH/MPD streaming, and DRM ClearKey protection. It also integrates with Supabase for storing channel data and configurations and includes a user-friendly web interface for configuration.

## Features

- IPTV playlist (M3U) support
- Supports direct HTTP/HTTPS URLs, HLS (m3u8), and regular M3U playlists
- MPD/DASH manifest support and DRM ClearKey protection for secure streams
- Automatic stream type detection (DASH vs. HLS)
- Channel metadata including logos, groups, and descriptions
- Configurable via a web interface and a dedicated API endpoint
- API endpoints for manifest, channel catalog, metadata, and stream details
- Docker and Vercel deployment support
- Built using Express and the stremio-addon-sdk

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Usage](#usage)
- [Database Setup](#database-setup)
- [Development](#development)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Prerequisites

- Node.js (>= 18)
- npm
- A Supabase account (for persisting channel and addon configuration data)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/ronspeclin/stremio-iptv-drm.git
   ```

2. Navigate to the project directory:
   ```bash
   cd stremio-iptv-drm
   ```

3. Install the dependencies:
   ```bash
   npm install
   ```
   
## Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables (replace placeholders with your actual values):

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=7665
```

> **Note:** Ensure your Supabase project has two tables:
> - **channels** with at least these fields: `user_id`, `m3u_url`, `base64_config`, `channels` (stored as JSON), and `updated_at`.
> - **addon_config** with fields: `user_id`, `base64_config`, and `updated_at`.


### M3U Playlist and KODIPROP Support

The addon supports additional KODIPROP tags inside your M3U playlist to configure DRM and stream behavior:

```
#KODIPROP:inputstreamaddon=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=dash
#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey
#KODIPROP:inputstream.adaptive.license_key=key:value
```

## API Endpoints

The following endpoints are exposed to manage the addon configuration and serve channel data:

### POST /configure

- **Description:**  
  Configures the addon with your M3U playlist and custom settings.
  
- **Request Body Example:**
  ```json
  {
    "m3uUrl": "https://example.com/playlist.m3u",
    "config": "base64_encoded_JSON_configuration"
  }
  ```
  The `config` field is a Base64-encoded JSON string. It may include properties such as:
  - `BaseURL` (automatically set to the origin of the M3U URL)
  - `name` (custom name for your playlist)
  - `description` (optional)
  - Optional fields like `epgUrl` and `logo` can also be provided.

- **Response:**  
  Returns a JSON object with:
  - `userId`: A unique identifier generated from your configuration
  - `addonUrl`: The URL to add to Stremio as an external addon source

### GET /:userConf/manifest.json

- **Description:**  
  Returns the addon manifest required by Stremio. Replace `:userConf` with your Base64-encoded configuration.
  
- **Response:**  
  A JSON manifest containing fields like `id`, `version`, `name`, `description`, supported `resources`, `types`, and catalog details.

### GET /:userConf/catalog/tv/iptv_catalog.json

- **Description:**  
  Retrieves the catalog of TV channels based on your configuration.
  
- **Response:**  
  A JSON object with:
  - `metas`: List of channels (each with id, name, logo, description, etc.)
  - Caching hints: `cacheMaxAge` and `staleRevalidate` values

### GET /:userConf/meta/tv/:id.json

- **Description:**  
  Returns detailed metadata for a specific channel identified by `:id`.
  
- **Response:**  
  A JSON object with channel metadata including title, poster, background, logo, description, runtime, and genres.

### GET /:userConf/stream/tv/:id.json

- **Description:**  
  Provides streaming details for a given channel including the stream URL and DRM information if applicable.
  
- **Response:**  
  A JSON object with a list of streams. For DASH streams, extra behavior hints are included (e.g., `notWebReady` and DRM `clearKeys`).

## Usage

1. **Start the Addon Server:**  
   Run the server locally using:
   ```bash
   npm run dev
   ```

2. **Access the Configuration Interface:**  
   Open your browser and navigate to [http://localhost:7665](http://localhost:7665).  
   The web interface lets you enter:
   - M3U playlist URL (required)
   - Optional EPG URL
   - Custom addon name and description
   - Optional language checkboxes (modify the generated configuration if needed)
   - Optional logo URL

3. **Configure and Activate the Addon:**  
   Submitting the form sends a POST request to `/configure` and returns an `addonUrl`.

4. **Add to Stremio:**  
   Copy the returned `addonUrl` (formatted as `stremio://<host>/<config>/manifest.json`) and add it as an external addon in Stremio.

5. **Root Endpoint Behavior:**  
   - When accessed from a browser, the root URL (`/`) serves the configuration page.
   - When accessed by a Stremio client (detected via the User-Agent header), it returns a default JSON manifest.
   
## Database Setup

Ensure that your Supabase project contains the following tables with the appropriate fields:

- **channels**
  - `user_id` (string)
  - `m3u_url` (string)
  - `base64_config` (string)
  - `channels` (JSON) – an array containing parsed channel objects
  - `updated_at` (timestamp)

- **addon_config**
  - `user_id` (string)
  - `base64_config` (string)
  - `updated_at` (timestamp)

### Run this on your Supabase SQL Editor Tab

```sql:supabase/schema.sql
-- Supabase Schema for Stremio IPTV Addon

-- Create the "channels" table
CREATE TABLE IF NOT EXISTS public.channels (
  user_id text PRIMARY KEY,
  m3u_url text NOT NULL,
  base64_config text NOT NULL,
  channels jsonb, -- Stores the parsed channel objects as JSON
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create the "addon_config" table
CREATE TABLE IF NOT EXISTS public.addon_config (
  user_id text PRIMARY KEY,
  base64_config text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### How to Use This Script

1. Log into your [Supabase dashboard](https://app.supabase.com/).
2. Select your project.
3. Navigate to the SQL Editor.
4. Copy and paste the script above into a new query.
5. Execute the query to create the tables.

This schema allows the addon to update channel lists and configuration details based on your requests.

## Development

### Local Development

- To run the development server:
  ```bash
  npm run dev
  ```
- The application serves a configuration interface at the root URL.  
- API endpoints can be tested using curl or Postman. For example:
  ```bash
  curl -X POST http://localhost:7665/configure \
    -H "Content-Type: application/json" \
    -d '{"m3uUrl": "https://example.com/playlist.m3u", "config": "base64_encoded_config_here"}'
  ```

### Docker Development

- **Build the Docker image:**
  ```bash
  npm run docker:build
  ```
- **Run the Docker container:**
  ```bash
  npm run docker:run
  ```
- **Using Docker Compose:**  
  - For development:
    ```bash
    npm run docker:dev
    ```
  - For production:
    ```bash
    npm run docker:prod
    ```

## Deployment

### Deploy to Vercel

1. **Install the Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Deploy the Project:**
   ```bash
   vercel
   ```

4. **Deploy to Production:**
   ```bash
   vercel --prod
   ```

## Project Structure

- **index.js:** Main application file containing API endpoints and addon configuration logic.
- **server.js:** Starts the Express server.
- **public/**
  - `index.html`: Web configuration interface.
  - `background.js`: Example background script used by the addon.
- **Dockerfile** and **docker-compose.yml:** Docker configuration for containerized deployment.
- **vercel.json:** Deployment configuration for Vercel.
- **package.json:** Lists project dependencies and npm scripts.

## Contributing

Contributions are always welcome! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes with descriptive messages.
4. Open a pull request detailing your changes and the motivation behind them.
5. Open issues if you encounter bugs or have feature proposals.

## License

This project is licensed under the MIT License.