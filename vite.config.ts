import { defineConfig, loadEnv, runnerImport } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { fileURLToPath } from 'node:url';

// Dev-only: the server auth logic in ./api is loaded on demand when the dev/preview
// server handles an /api/auth request. Production builds (Amplify) never load it,
// so the api/ folder (deployed separately to AWS Lambda) does not need to be in the repo.
let devAuthLib: Promise<{ processLogin: any; processChangePassword: any; processForgotPassword: any }> | undefined;
function loadDevAuthLib() {
  if (!devAuthLib) {
    devAuthLib = Promise.all([
      runnerImport<any>(fileURLToPath(new URL('./api/_lib/authLogic.ts', import.meta.url))),
      runnerImport<any>(fileURLToPath(new URL('./api/_lib/passwordLogic.ts', import.meta.url)))
    ]).then(([auth, pwd]) => ({
      processLogin: auth.module.processLogin,
      processChangePassword: pwd.module.processChangePassword,
      processForgotPassword: pwd.module.processForgotPassword
    }));
    devAuthLib.catch(() => { devAuthLib = undefined; });
  }
  return devAuthLib;
}

// NEW-1: Vite dev server imports shared auth logic directly, ensuring 100% parity with Vercel production
function authLoginPlugin(gatewayUser?: string, gatewayPass?: string, dotnetBase?: string) {
  const handler = async (req: any, res: any, next: any) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (
      (url === '/api/auth/login' || url === '/api/auth/change-password' || url === '/api/auth/forgot-password') &&
      (req.method === 'POST' || req.method === 'PUT')
    ) {
      let bodyStr = '';
      req.on('data', (chunk: any) => {
        bodyStr += chunk;
      });
      req.on('end', async () => {
        try {
          const { processLogin, processChangePassword, processForgotPassword } = await loadDevAuthLib();
          const body = bodyStr ? JSON.parse(bodyStr) : {};
          const forwarded = req.headers['x-forwarded-for'];
          const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress;

          const clientTarget = req.headers['x-target-api-base'];
          const targetBase = (typeof clientTarget === 'string' && clientTarget.trim())
            ? clientTarget.trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '').replace(/\/+$/, '')
            : (dotnetBase || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '').replace(/\/+$/, '');

          let result: any;
          if (url === '/api/auth/login') {
            result = await processLogin({
              username: body.username,
              password: body.password,
              deviceId: body.deviceId || 'WEB-PWA-DEV',
              gatewayUser,
              gatewayPass,
              dotnetBase: targetBase,
              clientIp
            });
            console.log(`[auth-middleware] Login attempt for '${body.username}' (${targetBase}): status=${result?.statusCode}, msg='${result?.body?.message}'`);
          } else if (url === '/api/auth/change-password') {
            result = await processChangePassword({
              username: body.username,
              currentPassword: body.currentPassword,
              newPassword: body.newPassword,
              confirmPassword: body.confirmPassword,
              gatewayUser,
              gatewayPass,
              dotnetBase: targetBase
            });
          } else if (url === '/api/auth/forgot-password') {
            result = await processForgotPassword({
              username: body.username,
              newPassword: body.newPassword,
              confirmPassword: body.confirmPassword,
              gatewayUser,
              gatewayPass,
              dotnetBase: targetBase
            });
          }

          if (!result) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ status: 0, message: 'Not found' }));
          }

          res.statusCode = result.statusCode;
          if (result.headers) {
            for (const [k, v] of Object.entries(result.headers)) {
              res.setHeader(k, v);
            }
          }
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify(result.body));
        } catch (err: any) {
          console.error('[auth-middleware error]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ status: 0, message: 'Authentication service temporarily unavailable', error: err?.message }));
        }
      });
    } else {
      next();
    }
  };

  return {
    name: 'auth-login-middleware',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
}

function kmlProxyPlugin() {
  const kmlCache = new Map<string, string>();
  const handler = async (req: any, res: any, next: any) => {
    const urlStr = req.url || '';
    if (urlStr.startsWith('/api/kml-proxy') && req.method === 'GET') {
      try {
        const u = new URL(urlStr, 'http://localhost');
        const targetUrl = u.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ status: 0, message: 'Missing url query parameter' }));
        }

        if (kmlCache.has(targetUrl)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.end(kmlCache.get(targetUrl));
        }

        const parsed = new URL(targetUrl);
        const hostAllowed =
          parsed.hostname.endsWith('.amazonaws.com') ||
          parsed.hostname.endsWith('.agreeta.com') ||
          parsed.hostname.includes('s3');

        const isKmlOrXml =
          parsed.pathname.toLowerCase().endsWith('.kml') ||
          parsed.pathname.toLowerCase().endsWith('.xml') ||
          parsed.pathname.toLowerCase().includes('.kml');

        if (!hostAllowed || !isKmlOrXml) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ status: 0, message: 'Access denied: only .kml assets from allowed hosts permitted' })
          );
        }

        const resp = await fetch(targetUrl);
        res.statusCode = resp.status;
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const body = await resp.text();
        if (resp.status === 200 && body) {
          kmlCache.set(targetUrl, body);
        }
        return res.end(body);
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ status: 0, message: err?.message || 'KML proxy error' }));
      }
    }
    next();
  };

  return {
    name: 'kml-proxy-middleware',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
}

function weatherProxyPlugin(openMeteoApiKey?: string) {
  const handler = async (req: any, res: any, next: any) => {
    const urlStr = req.url || '';
    if (urlStr.startsWith('/api/weather') && req.method === 'GET') {
      try {
        const u = new URL(urlStr, 'http://localhost');
        const lat = u.searchParams.get('latitude') || '19.0356';
        const lng = u.searchParams.get('longitude') || '73.0699';
        const openMeteoUrl = `https://customer-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,surface_pressure,wind_speed_10m,weather_code,is_day&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code,is_day,et0_fao_evapotranspiration,evapotranspiration,soil_temperature_6cm&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,et0_fao_evapotranspiration&timezone=auto&forecast_days=6&apikey=${openMeteoApiKey || ''}`;

        const resp = await fetch(openMeteoUrl);
        res.statusCode = resp.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const body = await resp.text();
        return res.end(body);
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: err?.message || 'Weather proxy error' }));
      }
    }
    next();
  };

  return {
    name: 'weather-proxy-middleware',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
}

function diseaseImagesPlugin(accessKeyId?: string, secretAccessKey?: string) {
  const s3 = new S3Client({
    region: 'ap-south-1',
    credentials: {
      accessKeyId: accessKeyId || '',
      secretAccessKey: secretAccessKey || ''
    }
  });

  const handler = async (req: any, res: any, next: any) => {
    const urlStr = req.url || '';
    if (urlStr.startsWith('/api/disease-images') && req.method === 'GET') {
      try {
        const u = new URL(urlStr, 'http://localhost');
        const rawDisease = u.searchParams.get('disease') || '';
        let cleanName = rawDisease.toLowerCase().trim().replace(/\s+/g, '-');
        if (cleanName === 'dollar-spot') cleanName = 'dollar-spots';
        if (cleanName.includes('fairy-ring')) cleanName = 'fairy-ring';
        if (cleanName.includes('mildew')) cleanName = 'powdery-mildew';

        const bucket = 'pest-and-disease-golf';
        const region = 'ap-south-1';

        // 1. First query with primary prefix
        let prefix = `${cleanName}/`;
        let cmd = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix
        });
        let result = await s3.send(cmd);

        // 2. If no contents found, check if an existing folder in S3 matches the disease name
        if (!result.Contents || result.Contents.length === 0) {
          const topListCmd = new ListObjectsV2Command({
            Bucket: bucket,
            Delimiter: '/'
          });
          const topList = await s3.send(topListCmd);
          const prefixes = (topList.CommonPrefixes || []).map((p: any) => p.Prefix || '');
          const matched = prefixes.find((p: string) => {
            const normP = p.replace(/\/$/, '').toLowerCase();
            const normD = rawDisease.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normD.includes(normP.replace(/[^a-z0-9]/g, '')) || normP.replace(/[^a-z0-9]/g, '').includes(normD);
          });
          if (matched) {
            prefix = matched;
            result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
          }
        }

        const validExts = /\.(jpe?g|png|webp)$/i;
        const imageUrls = (result.Contents || [])
          .filter((obj: any) => obj.Key && obj.Key !== prefix && validExts.test(obj.Key))
          .map((obj: any) => {
            const encoded = (obj.Key || '').split('/').map((segment: string) => encodeURIComponent(segment).replace(/\+/g, '%20')).join('/');
            return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
          });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.end(JSON.stringify({ disease: rawDisease, folder: prefix, count: imageUrls.length, images: imageUrls }));
      } catch (err: any) {
        console.error('[disease-images error]', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: err?.message || 'Error fetching disease images' }));
      }
    }
    next();
  };

  return {
    name: 'disease-images-middleware',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
}

function dynamicApiProxyPlugin(defaultTarget: string) {
  const handler = async (req: any, res: any, next: any) => {
    const urlStr = req.url || '';
    if (urlStr.startsWith('/api') && !urlStr.startsWith('/api/auth') && !urlStr.startsWith('/api/kml-proxy') && !urlStr.startsWith('/api/weather') && !urlStr.startsWith('/api/disease-images')) {
      try {
        const clientTarget = req.headers['x-target-api-base'];
        const rawTarget = typeof clientTarget === 'string' && clientTarget.trim() ? clientTarget : defaultTarget;
        const targetBase = rawTarget.trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '').replace(/\/+$/, '');
        const upstreamUrl = `${targetBase}${urlStr}`;

        // Read request body for non-GET/HEAD methods
        let bodyBuffer: Buffer | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: any[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          bodyBuffer = Buffer.concat(chunks);
        }

        // Clean headers to forward
        const forwardHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.toLowerCase() === 'host' || k.toLowerCase() === 'connection') continue;
          if (typeof v === 'string') {
            forwardHeaders[k] = v;
          }
        }

        const fetchOpts: any = {
          method: req.method,
          headers: forwardHeaders,
          redirect: 'follow'
        };
        if (bodyBuffer && bodyBuffer.length > 0) {
          fetchOpts.body = bodyBuffer;
        }

        const upstreamResp = await fetch(upstreamUrl, fetchOpts);

        res.statusCode = upstreamResp.status;
        for (const [k, v] of upstreamResp.headers.entries()) {
          if (k.toLowerCase() === 'www-authenticate') continue; // Strip WWW-Authenticate to avoid browser popup dialog
          res.setHeader(k, v);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Target-Api-Base', targetBase);

        const arrayBuf = await upstreamResp.arrayBuffer();
        return res.end(Buffer.from(arrayBuf));
      } catch (err: any) {
        console.error('[dynamic-api-proxy fatal]', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ status: 0, message: 'Internal proxy error', error: err?.message }));
      }
    }
    next();
  };

  return {
    name: 'dynamic-api-proxy-plugin',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // D-3 / A-1 Build Guard: Ensure secrets are never prefixed with VITE_ to prevent bundling into client code
  const leakedVars = Object.keys(env).filter(
    (k) => k.startsWith('VITE_GATEWAY')
  );
  if (leakedVars.length > 0) {
    throw new Error(
      `Security Guard Violation: Sensitive server secret(s) found with VITE_ prefix: ${leakedVars.join(', ')}. Server secrets must NOT start with VITE_ to prevent client bundle inlining.`
    );
  }

  const apiTarget = (env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  const gatewayUser = env.GATEWAY_USER;
  const gatewayPass = env.GATEWAY_PASS;

  return {
    plugins: [
      react(),
      authLoginPlugin(gatewayUser, gatewayPass, apiTarget),
      kmlProxyPlugin(),
      weatherProxyPlugin(env.OPEN_METEO_API_KEY),
      diseaseImagesPlugin(env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY),
      dynamicApiProxyPlugin(apiTarget),
      VitePWA({
        // Manifest icons are already precached by globPatterns; adding them again creates duplicate
        // precache entries, which stops the service worker from installing.
        includeManifestIcons: false,
        registerType: 'autoUpdate',
        manifest: {
          name: 'GroundSense Golf Course Management',
          short_name: 'GroundSense',
          description: 'GroundSense Golf Course Turf Health and Field Task Management PWA',
          theme_color: '#1B5E20',
          background_color: '#F5F7F5',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: 'assets/logo.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg}'],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-cache',
                networkTimeoutSeconds: 3
              }
            },
            {
              urlPattern: /^\/api\/kml-proxy/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'kml-boundary-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60 // 30 Days
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^\/api\/ReferenceData/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'reference-data-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 7 * 24 * 60 * 60 // 7 Days
                }
              }
            }
          ]
        }
      })
    ],
    server: {
      host: true,
      port: 3000,
      allowedHosts: true,
      headers: {
        'X-Content-Type-Options': 'nosniff'
      }
    },
    preview: {
      host: true,
      port: 3000,
      allowedHosts: true,
      headers: {
        'X-Content-Type-Options': 'nosniff'
      }
    }
  };
});
