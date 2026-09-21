import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { MongoClient } from 'mongodb';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { bankRoutes } from './modules/bank/bank.routes.js';
import { deliveryRoutes } from './modules/delivery/delivery.routes.js';

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/eduassess?replicaSet=rs0';

export async function buildApp(mongoClient?: MongoClient) {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // 1. Plugins
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });
  await fastify.register(cookie);
  await fastify.register(errorHandlerPlugin);

  // 2. Attach Mongo Database Instance
  const client = mongoClient || new MongoClient(MONGO_URI);
  if (!mongoClient) {
    await client.connect();
  }
  const db = client.db(process.env.MONGO_DB || 'eduassess');
  (fastify as any).mongoDb = db;
  (fastify as any).mongoClient = client;

  // 3. Health check endpoints
  fastify.get('/healthz', async () => ({ status: 'ok', time: new Date().toISOString() }));
  fastify.get('/readyz', async () => {
    try {
      await db.command({ ping: 1 });
      return { status: 'ready', database: 'connected' };
    } catch {
      throw new Error('Database not ready');
    }
  });

  // 4. Register API v1 routes
  await fastify.register(authRoutes, { prefix: '/api/v1' });
  await fastify.register(bankRoutes, { prefix: '/api/v1' });
  await fastify.register(deliveryRoutes, { prefix: '/api/v1' });

  return fastify;
}

async function start() {
  const fastify = await buildApp();

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, starting graceful shutdown...`);
      await fastify.close();
      const client = (fastify as any).mongoClient as MongoClient;
      if (client) {
        await client.close();
      }
      process.exit(0);
    });
  }

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`EduAssess API server running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  start();
}

