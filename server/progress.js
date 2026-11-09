const { createInitialProgress } = require('./engine');

function toProgress({ player, campaign, endless }) {
  return { player, campaign, endless };
}

async function initializeProgress(client, userId) {
  const { player, campaign, endless } = createInitialProgress();
  await client.query(
    'INSERT INTO progress (user_id, player, campaign, endless) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING',
    [userId, player, campaign, endless],
  );
}

module.exports = { initializeProgress, toProgress };
