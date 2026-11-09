'use strict';
const test = global.test || require('node:test');
const assert = require('node:assert/strict');
const engine = () => require('../../server/engine');
const turn = (params = {}) => {
  const { createInitialProgress, createEnemy, resolveTurn } = engine();
  return resolveTurn({
    progress: createInitialProgress(), enemy: createEnemy({ section: 0, fight: 6, mode: 'campaign' }),
    correct: true, elapsedMs: 10000, timeLimitSeconds: 20, mode: 'campaign', ...params,
  });
};

test('speed and combo thresholds apply integer damage without mutating inputs', () => {
  const progress = engine().createInitialProgress();
  progress.player.combo = 2;
  const enemy = engine().createEnemy({ section: 0, fight: 6, mode: 'campaign' });
  const snapshot = JSON.parse(JSON.stringify({ progress, enemy }));
  assert.equal(turn({ progress, enemy }).damageDealt, 22);
  assert.equal(turn({ progress, enemy, elapsedMs: 15000 }).damageDealt, 18);
  assert.equal(turn({ progress, enemy, elapsedMs: 22000 }).damageDealt, 15);
  assert.deepEqual({ progress, enemy }, snapshot);
  progress.player.combo = 4;
  assert.equal(turn({ progress, enemy }).damageDealt, 30);
});

test('damage taken resets combo and carries into the no-damage reward', () => {
  const { createEnemy } = engine();
  const enemy = createEnemy({ section: 0, fight: 0, mode: 'campaign' });
  const first = turn({ enemy, correct: false });
  assert.equal(first.damageTaken, 10);
  assert.equal(first.progress.player.combo, 0);
  assert.equal(first.noDamage, false);
  const second = turn({ ...first });
  const won = turn({ ...second });
  assert.equal(won.status, 'won');
  assert.equal(won.earnedXp, 10);
  assert.equal(won.progress.player.hp, 90);
  assert.equal(won.progress.campaign.fight, 1);
  const clean = turn({ enemy: { ...enemy, hp: 1 } });
  assert.equal(clean.earnedXp, 15);
});

test('rank gains change max HP without healing until a section clears', () => {
  const { createInitialProgress, createEnemy, getRank } = engine();
  const progress = createInitialProgress();
  progress.player = { ...progress.player, hp: 40, xp: 145 };
  const enemy = createEnemy({ section: 0, fight: 0, mode: 'campaign' });
  const rank = turn({ progress, enemy: { ...enemy, hp: 1 } });
  assert.equal(rank.progress.player.rank, 'Analyst');
  assert.equal(rank.progress.player.hp, 40);
  assert.equal(rank.progress.player.maxHp, 110);
  assert.ok(rank.rankUp);
  assert.deepEqual(getRank(1400), { name: 'CISO Whisperer', index: 4, maxHp: 140, minXp: 1400, nextXp: null });
  const boss = createEnemy({ section: 0, fight: 6, mode: 'campaign' });
  rank.progress.campaign.fight = 6;
  const clear = turn({ progress: rank.progress, enemy: { ...boss, hp: 1 } });
  assert.equal(clear.progress.player.hp, 110);
  assert.deepEqual(clear.progress.campaign, { section: 1, fight: 0, cleared: [true, false, false, false, false, false, false] });
});

test('final boss unlocks endless and five kills raise difficulty and attack', () => {
  const { createInitialProgress, createEnemy } = engine();
  const progress = createInitialProgress();
  progress.campaign = { section: 6, fight: 6, cleared: [true, true, true, true, true, true, false] };
  const enemy = createEnemy({ section: 6, fight: 6, mode: 'campaign' });
  const final = turn({ progress, enemy: { ...enemy, hp: 1 } });
  assert.equal(final.progress.endless.unlocked, true);
  assert.ok(final.progress.campaign.cleared.every(Boolean));
  final.progress.endless.kills = 4;
  const endless = turn({ mode: 'endless', progress: final.progress, enemy: { ...enemy, hp: 1 } });
  assert.deepEqual(endless.progress.endless, { kills: 5, difficulty: 1, unlocked: true });
  const scaled = createEnemy({ mode: 'endless', difficulty: 1, rng: () => 0.99 });
  assert.equal(scaled.section, 6);
  assert.equal(scaled.type, 'boss');
  assert.equal(scaled.attack, 25);
});

test('death and forfeits restart the current run while retaining XP and unlocks', () => {
  const { createInitialProgress, forfeitProgress } = engine();
  const progress = createInitialProgress();
  progress.player = { hp: 10, maxHp: 110, xp: 150, rank: 'Analyst', combo: 4 };
  progress.campaign = { section: 2, fight: 4, cleared: [true, true, false, false, false, false, false] };
  progress.endless = { kills: 8, difficulty: 1, unlocked: true };
  const lost = turn({ progress, correct: false });
  assert.equal(lost.status, 'lost');
  assert.equal(lost.progress.campaign.section, 2);
  assert.equal(lost.progress.campaign.fight, 0);
  assert.equal(lost.progress.player.hp, 110);
  assert.equal(lost.progress.player.xp, 150);
  assert.equal(lost.progress.player.combo, 0);
  const restarted = forfeitProgress(progress, 'endless');
  assert.deepEqual(restarted.endless, { kills: 0, difficulty: 0, unlocked: true });
  assert.deepEqual(restarted.campaign, progress.campaign);
  assert.equal(progress.endless.kills, 8);
});
