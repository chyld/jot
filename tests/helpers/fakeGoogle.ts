// A stand-in for Google Fonts, so API tests exercise Jot's real download code
// without depending on the network. It mimics the three endpoints Jot uses:
//   /metadata/fonts   the catalogue (with Google's ")]}'" prefix)
//   /css2             the CSS API, returning @font-face blocks per subset
//   /s/<file>.woff2   the font files
import Fastify, { type FastifyInstance } from 'fastify';

export interface FakeFamily {
  family: string;
  category: string;
  fonts: Record<string, object>;
}

export const FAKE_FAMILIES: FakeFamily[] = [
  { family: 'Roboto Slab', category: 'Serif', fonts: { '400': {}, '700': {} } },
  { family: 'Bebas Neue', category: 'Display', fonts: { '400': {} } },
  { family: 'Merriweather', category: 'Serif', fonts: { '300': {}, '400': {}, '400i': {}, '700': {}, '700i': {} } },
  { family: 'Space Grotesk', category: 'Sans Serif', fonts: { '400': {}, '700': {} } },
  { family: 'Broken Font', category: 'Display', fonts: { '400': {} } },
  { family: 'Inter', category: 'Sans Serif', fonts: { '400': {}, '700': {} } },
  // Every file fails on its first request and works on the second.
  { family: 'Flaky Font', category: 'Display', fonts: { '400': {} } },
  // Every file always fails.
  { family: 'Dead Files', category: 'Display', fonts: { '400': {} } },
];

export const WOFF2_BYTES = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60, 7)]);

export interface FakeGoogle {
  server: FastifyInstance;
  origin: string;
  css2Requests: string[];
  config: { metadataUrl: string; cssUrl: string; allowedFileOrigins: string[] };
  close(): Promise<void>;
}

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const server = Fastify({ logger: false });
  const css2Requests: string[] = [];
  let origin = '';

  server.get('/metadata/fonts', async (_req, reply) => {
    reply.type('application/json');
    return ")]}'\n" + JSON.stringify({ familyMetadataList: FAKE_FAMILIES });
  });

  server.get('/css2', async (req, reply) => {
    const url = new URL(req.url, origin);
    css2Requests.push(url.search);
    const familyParam = url.searchParams.get('family') ?? '';
    const [name, axes] = familyParam.split(':');
    if (name === 'Broken Font') {
      reply.code(500);
      return 'boom';
    }
    if (!FAKE_FAMILIES.some((f) => f.family === name)) {
      reply.code(400);
      return 'unknown family';
    }
    // Work out which (italic, weight) pairs were requested.
    const pairs: Array<[number, number]> = [];
    if (!axes) pairs.push([0, 400]);
    else if (axes.startsWith('ital,wght@')) {
      for (const t of axes.slice('ital,wght@'.length).split(';')) {
        const [i, w] = t.split(',').map(Number);
        pairs.push([i, w]);
      }
    } else if (axes.startsWith('wght@')) {
      for (const w of axes.slice('wght@'.length).split(';')) pairs.push([0, Number(w)]);
    }
    const slug = name.toLowerCase().replace(/ /g, '');
    let css = '';
    for (const [ital, wght] of pairs) {
      for (const subset of ['latin-ext', 'latin']) {
        css += `/* ${subset} */\n@font-face {\n  font-family: '${name}';\n  font-style: ${ital ? 'italic' : 'normal'};\n  font-weight: ${wght};\n  font-display: swap;\n  src: url(${origin}/s/${slug}-${ital}-${wght}-${subset}.woff2) format('woff2');\n  unicode-range: ${subset === 'latin' ? 'U+0000-00FF, U+0131, U+2000-206F' : 'U+0100-02BA, U+1E00-1E9F'};\n}\n`;
      }
    }
    reply.type('text/css');
    return css;
  });

  const seen = new Set<string>();
  server.get('/s/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (file.startsWith('deadfiles-')) {
      reply.code(503);
      return 'unavailable';
    }
    if (file.startsWith('flakyfont-') && !seen.has(file)) {
      seen.add(file);
      reply.code(500);
      return 'try again';
    }
    reply.type('font/woff2');
    return WOFF2_BYTES;
  });

  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;

  return {
    server,
    origin,
    css2Requests,
    config: {
      metadataUrl: `${origin}/metadata/fonts`,
      cssUrl: `${origin}/css2`,
      allowedFileOrigins: [origin],
    },
    close: () => server.close(),
  };
}
