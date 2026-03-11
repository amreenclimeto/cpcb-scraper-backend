import IORedis from "ioredis";

let connection;

export async function getRedisConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_CLIENT_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}
