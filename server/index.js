const { createApp } = require('./app');
const { createPool } = require('./db');

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

const pool = createPool();
const server = createApp({ pool }).listen(port, '0.0.0.0', () => {
  console.log('AppSec RPG listening on port ' + port);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    try {
      await pool.end();
    } catch {
      process.exitCode = 1;
    }
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
