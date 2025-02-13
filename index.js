import express from 'express';
import cors from 'cors';
import pkg from 'stremio-addon-sdk';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from './logger.js'; //remove this later

const { addonBuilder, serveHTTP } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Express app
const app = express();

// Add at the top after creating the Express app// remove later
if (process.env.DEBUG) {
    app.use(logger.requestLogger);
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Utility function to generate consistent user ID
function generateUserId(config) {
    return crypto.createHash('md5')
        .update(JSON.stringify(config))
        .digest('hex');
}

// Utility function to parse base64 config
function parseConfig(base64Config) {
    try {
        return JSON.parse(Buffer.from(base64Config, 'base64').toString('utf-8'));
    } catch (error) {
        console.error('Config parsing error:', error);
        return null;
    }
}

// Middleware
app.use(cors());
app.use(express.json());

// Configure endpoint
// Modify the configure endpoint
app.post('/configure', async (req, res) => {
    try {
        const { m3uUrl, config } = req.body;
        
        if (!m3uUrl || !config) {
            return res.status(400).json({ error: 'M3U URL and config are required' });
        }

        // Fetch M3U file
        const response = await fetch(m3uUrl);
        if (!response.ok) {
            return res.status(400).json({ error: 'Failed to fetch M3U file' });
        }

        const content = await response.text();
        const parsedConfig = parseConfig(config);

        if (!parsedConfig) {
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        const userId = generateUserId(parsedConfig);

        // Parse M3U file
        const channels = parseM3U(content);

        // Store channels and configuration
        await supabase.from('channels').upsert({
            user_id: userId,
            m3u_url: m3uUrl,
            base64_config: config,
            channels: channels, // Use parsed channels
            updated_at: new Date().toISOString()
        });

        await supabase.from('addon_config').upsert({
            user_id: userId,
            base64_config: config,
            updated_at: new Date().toISOString()
        });

        // Generate addon URL with base64 config in the path
        const addonUrl = `stremio://${req.get('host')}/${config}/manifest.json`;

        res.json({
            userId,
            addonUrl
        });
    } catch (error) {
        console.error('Configuration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// M3U Parser function with comprehensive parsing
function parseM3U(content) {
    const channels = [];
    const lines = content.split('\n');
    let currentChannel = null;

    console.log('Parsing M3U - Total lines:', lines.length);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        if (!line || line === '#EXTM3U') continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {
                id: '',
                name: '',
                logo: '',
                group: '',
                url: '',
                drm: null
            };

            // Parse extended attributes
            const attributes = {};
            const attrMatches = line.match(/([a-zA-Z-]+)="([^"]*)"/g);
            if (attrMatches) {
                attrMatches.forEach(attr => {
                    const [key, value] = attr.split('=');
                    attributes[key.toLowerCase()] = value.replace(/"/g, '');
                });
            }

            // Extract channel name
            const nameMatch = line.match(/,(.+)$/);
            if (nameMatch) {
                currentChannel.name = nameMatch[1].trim();
            }

            // Set channel properties from attributes
            currentChannel.id = attributes['tvg-id'] || currentChannel.name;
            currentChannel.logo = attributes['tvg-logo'] || '';
            currentChannel.group = attributes['group-title'] || '';

        } else if (line.startsWith('#KODIPROP:')) {
            // Handle DRM properties
            if (!currentChannel.drm) {
                currentChannel.drm = {
                    inputstreamAddon: '',
                    manifestType: '',
                    licenseType: '',
                    licenseKey: '',
                    headers: {}
                };
            }

            const propMatch = line.replace('#KODIPROP:', '').split('=');
            if (propMatch.length === 2) {
                const [key, value] = propMatch;
                switch (key.toLowerCase()) {
                    case 'inputstreamaddon':
                        currentChannel.drm.inputstreamAddon = value;
                        break;
                    case 'inputstream.adaptive.manifest_type':
                        currentChannel.drm.manifestType = value;
                        break;
                    case 'inputstream.adaptive.license_type':
                        currentChannel.drm.licenseType = value;
                        break;
                    case 'inputstream.adaptive.license_key':
                        currentChannel.drm.licenseKey = value;
                        break;
                    default:
                        currentChannel.drm.headers[key] = value;
                }
            }
        } else if (line.startsWith('http') && currentChannel) {
            currentChannel.url = line;
            
            if (currentChannel.name && currentChannel.url) {
                // Generate a unique ID if none exists
                if (!currentChannel.id) {
                    currentChannel.id = Buffer.from(currentChannel.url).toString('base64').replace(/=/g, '');
                }
                
                // Remove empty DRM object if no properties were set
                if (currentChannel.drm && 
                    !currentChannel.drm.inputstreamAddon && 
                    !currentChannel.drm.manifestType && 
                    !currentChannel.drm.licenseType && 
                    !currentChannel.drm.licenseKey && 
                    Object.keys(currentChannel.drm.headers).length === 0) {
                    currentChannel.drm = null;
                }

                channels.push(currentChannel);
                console.log('Parsed channel:', JSON.stringify(currentChannel, null, 2));
            }
            
            currentChannel = null;
        }
    }

    console.log(`Parsed ${channels.length} channels`);
    return channels;
}


// Manifest endpoint
app.get(['/:userConf/manifest.json'], async (req, res) => {
    const { userConf } = req.params;

    try {
        const parsedConfig = parseConfig(userConf);
        if (!parsedConfig) {
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        const userId = generateUserId(parsedConfig);

        res.json({
            id: `org.stremio.iptv.${userId}`,
            version: "1.0.0",
            name: parsedConfig.name || "IPTV Channels",
            description: parsedConfig.description || "Watch IPTV channels in Stremio",
            resources: ["catalog", "meta", "stream"],
            types: ["tv"],
            catalogs: [{
                type: "tv",
                id: "iptv_catalog",
                name: parsedConfig.name || "IPTV Channels"
            }],
            behaviorHints: {
                configurable: true,
                configurationRequired: false
            }
        });
    } catch (error) {
        console.error('Manifest generation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Catalog endpoint
app.get(['/:userConf/catalog/tv/iptv_catalog.json'], async (req, res) => {
    const { userConf } = req.params;
    
    if (process.env.DEBUG) {
        logger.info('catalog', 'Starting catalog request', { userConf });
    }

    try {
        const parsedConfig = parseConfig(userConf);
        if (!parsedConfig) {
            if (process.env.DEBUG) {
                logger.error('catalog', 'Invalid configuration', { userConf });
            }
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        const userId = generateUserId(parsedConfig);
        if (process.env.DEBUG) {
            logger.info('catalog', 'Generated userId', { userId });
        }

        const { data, error } = await supabase
            .from('channels')
            .select('channels')
            .eq('user_id', userId)
            .single();

        if (error) {
            if (process.env.DEBUG) {
                logger.error('catalog', 'Supabase query failed', error);
            }
            return res.json({ metas: [] });
        }

        const metas = (data.channels || []).map(channel => ({
            id: `iptv_${channel.id || channel.name}`,
            type: 'tv',
            name: channel.name,
            poster: channel.logo || '',
            description: channel.group || '',
        }));

        if (process.env.DEBUG) {
            logger.info('catalog', `Generated ${metas.length} channel metas`, {
                firstChannel: metas[0],
                lastChannel: metas[metas.length - 1]
            });
        }

        res.json({ 
            metas,
            type: 'tv',
            id: 'iptv_catalog' 
        });
    } catch (error) {
        if (process.env.DEBUG) {
            logger.error('catalog', 'Catalog generation error', error);
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Stream endpoint
app.get(['/:userConf/stream/tv/:id.json'], async (req, res) => {
   const { userConf, id } = req.params;
   if (process.env.DEBUG) {
       logger.info('stream', 'Starting stream request', { userConf, id });
   }

   try {
       const parsedConfig = parseConfig(userConf);
       if (!parsedConfig) {
           if (process.env.DEBUG) {
               logger.error('stream', 'Invalid configuration', { userConf });
           }
           return res.status(400).json({ error: 'Invalid configuration' });
       }

       const userId = generateUserId(parsedConfig);
       if (process.env.DEBUG) {
           logger.info('stream', 'Generated userId', { userId });
       }

       const { data, error } = await supabase
           .from('channels')
           .select('channels')
           .eq('user_id', userId)
           .single();

       if (error) {
           if (process.env.DEBUG) {
               logger.error('stream', 'Supabase query failed', error);
           }
           return res.json({ streams: [] });
       }

       const channel = (data.channels || []).find(c => 
           `iptv_${c.id || c.name}` === id
       );

       if (!channel) {
           if (process.env.DEBUG) {
               logger.warn('stream', 'Channel not found', { id });
           }
           return res.json({ streams: [] });
       }

       if (process.env.DEBUG) {
           logger.info('stream', 'Found channel', { 
               channelName: channel.name,
               channelId: channel.id || channel.name,
               url: channel.url,
               hasDRM: !!channel.drm,
               urlType: channel.url.includes('.mpd') ? 'DASH' : 
                       channel.url.includes('.m3u8') ? 'HLS' : 'Other'
           });
       }

       // Determine stream type
       const isDASH = channel.url.toLowerCase().includes('.mpd');
       const isHLS = channel.url.toLowerCase().includes('.m3u8');

       // Stream object to be returned
       const stream = {
           url: channel.url,
           name: channel.name
       };

       // Special handling for DASH streams with DRM
       if (isDASH && channel.drm) {
           // Validate DRM configuration
           if (!channel.drm.licenseKey) {
               if (process.env.DEBUG) {
                   logger.error('stream', 'Invalid DRM configuration - missing license key', { 
                       channelName: channel.name 
                   });
               }
               return res.json({ streams: [] });
           }
		   
		   // Prepare MediaFlow proxy URL
			const [keyId, key] = channel.drm.licenseKey.split(':');
			const mediaflowProxyUrl = `${process.env.MEDIAFLOW_SERVER_URL}/proxy/mpd/manifest.m3u8?d=${encodeURIComponent(channel.url)}&key_id=${keyId}&key=${key}&api_password=${process.env.MEDIAFLOW_API_PASSWORD}`;

           // Update stream URL to MediaFlow HLS proxy
           stream.url = mediaflowProxyUrl;

           // Set behavior hints for HLS
           stream.behaviorHints = {
               notWebReady: true,
               playerType: "hls"
           };

           if (process.env.DEBUG) {
               logger.info('stream', 'Converted DASH DRM to HLS proxy', {
                   originalUrl: channel.url,
                   proxyUrl: stream.url,
                   keyIdPresent: !!keyId
               });
           }
       } 
       // Handle non-DRM or HLS streams
       else {
           stream.behaviorHints = {
               notWebReady: true,
               playerType: isDASH ? "mpegdash" : (isHLS ? "hls" : "other")
           };
           
           if (process.env.DEBUG) {
               logger.info('stream', 'Prepared stream', {
                   streamType: stream.behaviorHints.playerType
               });
           }
       }

       if (process.env.DEBUG) {
           logger.info('stream', 'Generated final stream response', { 
               streamUrl: stream.url,
               streamName: stream.name,
               hasBehaviorHints: !!stream.behaviorHints
           });
       }

       res.json({
           streams: [stream]
       });
   } catch (error) {
       if (process.env.DEBUG) {
           logger.error('stream', 'Stream generation error', {
               error: error.message,
               stack: error.stack
           });
       }
       res.status(500).json({ error: 'Internal server error' });
   }
});

// Meta endpoint
app.get(['/:userConf/meta/tv/:id.json'], async (req, res) => {
    const { userConf, id } = req.params;
    
    if (process.env.DEBUG) {
        logger.info('meta', 'Starting meta request', { userConf, id });
    }

    try {
        const parsedConfig = parseConfig(userConf);
        if (!parsedConfig) {
            if (process.env.DEBUG) {
                logger.error('meta', 'Invalid configuration', { userConf });
            }
            return res.status(400).json({ error: 'Invalid configuration' });
        }

        const userId = generateUserId(parsedConfig);
        if (process.env.DEBUG) {
            logger.info('meta', 'Generated userId', { userId });
        }

        const { data, error } = await supabase
            .from('channels')
            .select('channels')
            .eq('user_id', userId)
            .single();
            
        if (error) {
            if (process.env.DEBUG) {
                logger.error('meta', 'Supabase query failed', error);
            }
            return res.json({ meta: null });
        }

        const channelId = id.replace('iptv_', '');
        const channel = (data.channels || []).find(c => 
            (c.id || c.name) === channelId
        );
        
        if (!channel) {
            if (process.env.DEBUG) {
                logger.warn('meta', 'Channel not found', { channelId });
            }
            return res.json({ meta: null });
        }

        if (process.env.DEBUG) {
            logger.info('meta', 'Found channel', { 
                channelName: channel.name,
                channelId: channel.id 
            });
        }

        const meta = {
            id: `iptv_${channel.id || channel.name}`,
            type: 'tv',
            name: channel.name,
            poster: channel.logo || '',
            description: channel.group || '',
            genres: [channel.group || 'TV'],
            posterShape: 'landscape'
        };

        if (process.env.DEBUG) {
            logger.info('meta', 'Generated meta response', meta);
        }

        res.json({ meta });
    } catch (error) {
        if (process.env.DEBUG) {
            logger.error('meta', 'Meta generation error', error);
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Root handler - serve HTML for browser, manifest for Stremio
app.get('/', (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    const isStremio = userAgent.includes('Stremio');

    if (isStremio) {
        res.json({
            id: "org.stremio.iptv",
            version: "1.0.0",
            name: "IPTV Addon",
            description: "Watch IPTV channels in Stremio",
            resources: ["catalog", "stream"],
            types: ["tv"],
            catalogs: [{
                type: "tv",
                id: "iptv_catalog",
                name: "IPTV Channels"
            }],
            behaviorHints: {
                configurable: true,
                configurationRequired: true
            }
        });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

export default app;