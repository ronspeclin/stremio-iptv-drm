import express from 'express';
import cors from 'cors';
import pkg from 'stremio-addon-sdk';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';

const { addonBuilder, serveHTTP } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store user data
const userConfigs = new Map();
const userChannels = new Map();
const userEpgData = new Map();
const userFavorites = new Map();
const userCategories = new Map();
const userLanguages = new Map();
const userLastAccess = new Map();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function parseM3UContent(content) {
    const lines = content.split('\n').map(line => line.trim());
    const channels = [];
    let currentChannel = null;
    let currentProps = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('#EXTINF:')) {
            currentProps = {};
            
            const match = line.match(/tvg-id="([^"]*)" tvg-logo="([^"]*)" group-title="([^"]*)",\s*(.+)/);
            currentChannel = {
                tvgId: match?.[1] || '',
                logo: match?.[2] || '',
                group: match?.[3] || 'No Category',
                name: match?.[4]?.trim() || line.split(',')[1]?.trim() || 'Unknown Channel',
                inputStream: {},
                drmConfig: {}
            };
        } 
        else if (line.startsWith('#KODIPROP:')) {
            if (!currentChannel) continue;
            
            const propLine = line.substring('#KODIPROP:'.length);
            const [key, value] = propLine.split('=').map(s => s.trim());
            
            currentProps[key] = value;
            
            if (key === 'inputstream.adaptive.manifest_type') {
                currentChannel.inputStream.manifestType = value;
            }
            else if (key === 'inputstream.adaptive.license_type') {
                currentChannel.inputStream.licenseType = value;
            }
            else if (key === 'inputstream.adaptive.license_key') {
                currentChannel.inputStream.licenseKey = value;
            }
        }
        else if (line.startsWith('http')) {
            if (currentChannel) {
                currentChannel.url = line;
                currentChannel.id = `iptv_${Buffer.from(line).toString('base64')}`;
                
                if (currentChannel.inputStream.licenseType === 'org.w3.clearkey') {
                    const [keyId, key] = currentChannel.inputStream.licenseKey.split(':');
                    currentChannel.drmConfig = {
                        keyId: keyId,
                        key: key,
                        manifestType: currentChannel.inputStream.manifestType,
                        licenseType: currentChannel.inputStream.licenseType
                    };
                }
                
                currentChannel.properties = currentProps;
                channels.push({...currentChannel});
                currentChannel = null;
                currentProps = {};
            }
        }
    }

    const categories = new Set(channels.map(ch => ch.group));
    console.log('Parsed channels:', channels.length);
    if (channels.length > 0) {
        console.log('Sample channel:', JSON.stringify(channels[0], null, 2));
    }

    return { channels, categories: Array.from(categories) };
}

async function loadM3UFile(userId, m3uUrl) {
    try {
        console.log(`Attempting to fetch M3U from: ${m3uUrl}`);
        
        const response = await fetch(m3uUrl, {
            headers: {
                'Accept': '*/*',
                'User-Agent': 'Stremio-IPTV-Addon'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const m3uContent = await response.text();
        console.log('M3U content first 100 chars:', m3uContent.substring(0, 100));
        
        if (!m3uContent.includes('#EXTM3U')) {
            throw new Error('Invalid M3U file format - missing #EXTM3U header');
        }

        const { channels, categories } = parseM3UContent(m3uContent);
        
        if (channels.length === 0) {
            throw new Error('No channels found in M3U file');
        }

        userCategories.set(userId, Array.from(categories));
        userChannels.set(userId, channels);
        
        console.log(`Successfully loaded ${channels.length} channels for user ${userId}`);
        console.log('Categories:', Array.from(categories));
        
        return true;
    } catch (error) {
        console.error('Detailed error loading M3U:', error);
        console.error('Error stack:', error.stack);
        return false;
    }
}

async function loadEPGData(userId, epgUrl) {
    if (!epgUrl) return false;
    
    try {
        const response = await fetch(epgUrl);
        let xmlData = await response.text();

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "_"
        });
        
        const epg = parser.parse(xmlData);
        const programmes = epg.tv.programme;
        
        // Organize EPG data by channel
        const channelPrograms = new Map();
        if (Array.isArray(programmes)) {
            programmes.forEach(program => {
                const channelId = program._channel;
                if (!channelPrograms.has(channelId)) {
                    channelPrograms.set(channelId, []);
                }
                channelPrograms.get(channelId).push({
                    start: program._start,
                    stop: program._stop,
                    title: program.title,
                    desc: program.desc,
                    category: program.category
                });
            });
        }
        
        userEpgData.set(userId, channelPrograms);
        return true;
    } catch (error) {
        console.error(`Error loading EPG for user ${userId}:`, error);
        return false;
    }
}

app.post('/configure', async (req, res) => {
    const { m3uUrl, epgUrl, name, description, filterGroups, logo, languages } = req.body;
    
    if (!m3uUrl) {
        return res.status(400).json({ error: 'M3U URL is required' });
    }

    try {
        const userId = crypto.randomBytes(16).toString('hex');
        
        userConfigs.set(userId, {
            m3uUrl,
            epgUrl,
            name: name || 'My IPTV Addon',
            description: description || 'Custom IPTV addon with DRM support',
            filterGroups: filterGroups || [],
            logo: logo || ''
        });

        if (languages) {
            userLanguages.set(userId, new Set(languages));
        }

        const success = await loadM3UFile(userId, m3uUrl);
        if (!success) {
            userConfigs.delete(userId);
            return res.status(400).json({ 
                error: 'Failed to load M3U file. Please check if the URL is accessible and contains valid M3U content.',
                details: 'Check the server logs for more information.'
            });
        }

        if (epgUrl) {
            await loadEPGData(userId, epgUrl);
        }

        res.json({
            success: true,
            message: 'Configuration updated',
            addonUrl: `${req.protocol}://${req.get('host')}/manifest.json?userId=${userId}`
        });
    } catch (error) {
        console.error('Configuration error:', error);
        res.status(500).json({ 
            error: 'Configuration failed',
            details: error.message
        });
    }
});

app.post('/favorite/:userId/:channelId', (req, res) => {
    const { userId, channelId } = req.params;
    const favorites = userFavorites.get(userId) || new Set();
    favorites.add(channelId);
    userFavorites.set(userId, favorites);
    res.json({ success: true });
});

app.delete('/favorite/:userId/:channelId', (req, res) => {
    const { userId, channelId } = req.params;
    const favorites = userFavorites.get(userId) || new Set();
    favorites.delete(channelId);
    userFavorites.set(userId, favorites);
    res.json({ success: true });
});

function createManifest(userId) {
    const config = userConfigs.get(userId) || {
        name: 'My IPTV Addon',
        description: 'Custom IPTV addon with DRM support',
        logo: ''
    };

    const categories = userCategories.get(userId) || [];

    return {
        id: `org.myiptvaddon.${userId}`,
        version: '1.0.0',
        name: config.name,
        description: config.description,
        logo: config.logo,
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: `iptv_catalog_${userId}`,
                name: 'All Channels'
            },
            {
                type: 'tv',
                id: `iptv_favorites_${userId}`,
                name: '⭐ Favorites'
            },
            ...categories.map(category => ({
                type: 'tv',
                id: `iptv_category_${category}_${userId}`,
                name: category
            }))
        ],
        idPrefixes: ['iptv_']
    };
}

function getAddonBuilder(userId) {
    const builder = new addonBuilder(createManifest(userId));

    builder.defineMetaHandler(({ type, id }) => {
        if (type === 'tv') {
            const channels = userChannels.get(userId) || [];
            const channel = channels.find(c => c.id === id);
            
            if (!channel) {
                return Promise.resolve({ meta: null });
            }

            const meta = {
                id: channel.id,
                type: 'tv',
                name: channel.name,
                poster: channel.logo,
                posterShape: 'square',
                background: channel.logo,
                logo: channel.logo,
                description: `${channel.name} - ${channel.group}`
            };

            return Promise.resolve({ meta });
        }
        return Promise.resolve({ meta: null });
    });

    builder.defineCatalogHandler(({ type, id }) => {
        if (type === 'tv') {
            const channels = userChannels.get(userId) || [];
            const epgData = userEpgData.get(userId);
            const favorites = userFavorites.get(userId) || new Set();
            const userLangs = userLanguages.get(userId);
            
            let filteredChannels = channels;

            if (userLangs && userLangs.size > 0) {
                filteredChannels = filteredChannels.filter(channel => 
                    userLangs.has(channel.language) || userLangs.has('any')
                );
            }
            
            if (id.startsWith('iptv_favorites_')) {
                filteredChannels = filteredChannels.filter(channel => favorites.has(channel.id));
            } else if (id.startsWith('iptv_category_')) {
                const category = id.split('_')[2];
                filteredChannels = filteredChannels.filter(channel => channel.group === category);
            }

            const metas = filteredChannels.map(channel => {
                const meta = {
                    id: channel.id,
                    type: 'tv',
                    name: channel.name,
                    poster: channel.logo,
                    posterShape: 'square',
                    background: channel.logo,
                    logo: channel.logo
                };

                if (epgData && epgData.has(channel.epgId)) {
                    const programs = epgData.get(channel.epgId);
                    const currentProgram = programs.find(program => {
                        const now = new Date();
                        const start = new Date(program.start);
                        const stop = new Date(program.stop);
                        return now >= start && now <= stop;
                    });

                    if (currentProgram) {
                        meta.description = `Now: ${currentProgram.title}\n${currentProgram.desc || ''}`;
                    }
                }

                return meta;
            });

            return Promise.resolve({ metas });
        }
        return Promise.resolve({ metas: [] });
    });

    builder.defineStreamHandler(({ type, id }) => {
        if (type === 'tv') {
            const channels = userChannels.get(userId) || [];
            const channel = channels.find(c => c.id === id);
            if (!channel) return Promise.resolve({ streams: [] });

            const stream = {
                name: channel.name,
                url: channel.url,
                description: `${channel.name} - ${channel.group}`
            };

            if (channel.inputStream.manifestType === 'dash') {
                stream.behaviorHints = {
                    bingeGroup: `iptv-${channel.group}`,
                    notWebReady: true
                };
            }

            if (channel.drmConfig && channel.inputStream.licenseType === 'org.w3.clearkey') {
                stream.behaviorHints = {
                    ...stream.behaviorHints,
                    drmConfig: {
                        type: 'ClearKey',
                        licenseKey: channel.inputStream.licenseKey,
                        keyId: channel.drmConfig.keyId,
                        key: channel.drmConfig.key,
                        properties: channel.properties
                    }
                };
            }

            return Promise.resolve({ streams: [stream] });
        }
        return Promise.resolve({ streams: [] });
    });

    return builder;
}

// Serve the addon
app.get('/*', (req, res) => {
    const userId = req.query.userId;
    if (!userId || !userConfigs.has(userId)) {
        // If no userId, serve the configuration page
        if (req.path === '/') {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
            return;
        }
        res.status(404).send({ error: 'Invalid configuration' });
        return;
    }

    userLastAccess.set(userId, Date.now());
    const builder = getAddonBuilder(userId);
    
    serveHTTP(builder.getInterface(), { server: req, res });
});

const port = process.env.PORT || 7000;
app.listen(port, () => {
    console.log(`Addon running at http://localhost:${port}`);
});

export default app;
