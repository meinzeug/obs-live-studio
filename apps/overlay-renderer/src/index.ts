import Fastify from 'fastify';
import { renderOverlay } from '@ans/overlay-engine';
const app = Fastify();
const demo = {
  id: 'main',
  name: 'Hauptnachricht',
  width: 1920,
  height: 1080,
  version: 1,
  published: true,
  elements: [
    {
      id: 't',
      type: 'text',
      name: 'Titel',
      x: 120,
      y: 680,
      width: 1500,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      hidden: false,
      props: { fontSize: 64 },
      binding: '{{article.title}}',
    },
  ],
};
app.get('/overlay/main-news', (_, r) =>
  r.type('text/html').send(renderOverlay(demo as any, { article: { title: 'Demo-Hauptmeldung' } })),
);
app.listen({ host: '127.0.0.1', port: 12002 });
