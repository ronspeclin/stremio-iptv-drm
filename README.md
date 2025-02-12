# Stremio IPTV Addon with DRM Support

A Stremio addon that allows you to watch your IPTV channels directly in Stremio. Supports MPD streams with ClearKey DRM protection.

## Features

- IPTV playlist (M3U) support
- DRM ClearKey support for protected streams
- MPD/DASH manifest support
- EPG (Electronic Program Guide) integration
- Channel categories/groups
- Multiple language filtering
- Favorites support

## Usage

1. Visit the addon URL (after deployment)
2. Configure your addon with:
   - Your M3U playlist URL
   - EPG URL (optional)
   - Preferred languages
   - Custom name and logo

3. Add the generated manifest URL to Stremio

## Supported Formats

- M3U/M3U8 playlists
- DASH/MPD streams
- ClearKey DRM protection
- XMLTV EPG format

## Development

```bash
# Clone the repository
git clone https://github.com/ronspeclin/stremio-iptv-drm.git

# Install dependencies
npm install

# Run locally
node index.js
```

## Deployment

The addon can be deployed to Vercel:

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

## Configuration

The addon supports the following KODIPROP tags in M3U files:
```
#KODIPROP:inputstreamaddon=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=dash
#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey
#KODIPROP:inputstream.adaptive.license_key=key:value
```

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
