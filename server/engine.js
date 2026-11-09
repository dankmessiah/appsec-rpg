'use strict';

const RANKS = [
  ['Intern', 0],
  ['Analyst', 150],
  ['AppSec Engineer', 400],
  ['Program Lead', 800],
  ['CISO Whisperer', 1400],
];

const TYPES = ['grunt', 'elite', 'boss'];
const ENEMY_RULES = {
  grunt: { hp: 20, attack: 10, xp: 10 },
  elite: { hp: 40, attack: 10, xp: 25 },
  boss: { hp: 80, attack: 20, xp: 60 },
};
const ENEMY_NAMES = [
  ['Scanner Scout', 'Taint Stalker', 'Toolchain Hydra'],
  ['Payload Imp', 'Exploit Wraith', 'Injection Hydra'],
  ['Cookie Goblin', 'Token Mimic', 'Identity Hydra'],
  ['Checklist Sprite', 'Framework Sentinel', 'Standards Hydra'],
  ['Severity Shade', 'Exposure Hunter', 'Risk Hydra'],
  ['Dependency Gremlin', 'Pipeline Phantom', 'Supply Chain Hydra'],
  ['Backlog Ghoul', 'Triage Golem', 'Program Hydra'],
];

function createInitialProgress() {
  return {
    player: { hp: 100, maxHp: 100, xp: 0, rank: 'Intern', combo: 0 },
    campaign: { section: 0, fight: 0, cleared: Array(ENEMY_NAMES.length).fill(false) },
    endless: { kills: 0, difficulty: 0, unlocked: false },
  };
}

function getRank(xp) {
  const index = Math.max(0, RANKS.findLastIndex(([, threshold]) => xp >= threshold));
  const [name, minXp] = RANKS[index];
  return { name, index, maxHp: 100 + 10 * index, minXp, nextXp: RANKS[index + 1]?.[1] ?? null };
}

function createEnemy({ section, fight, mode, difficulty = 0, rng = Math.random }) {
  const endless = mode === 'endless';
  const zone = endless ? Math.floor(rng() * ENEMY_NAMES.length) : section;
  const typeIndex = endless ? Math.floor(rng() * TYPES.length) : fight < 4 ? 0 : fight < 6 ? 1 : 2;
  const type = TYPES[typeIndex];
  const { hp, attack } = ENEMY_RULES[type];
  return {
    name: ENEMY_NAMES[zone][typeIndex],
    type,
    section: zone,
    hp,
    maxHp: hp,
    attack: attack + (endless ? 5 * difficulty : 0),
  };
}

function copyProgress(progress) {
  return {
    ...progress,
    player: { ...progress.player },
    campaign: { ...progress.campaign, cleared: [...progress.campaign.cleared] },
    endless: { ...progress.endless },
  };
}

function forfeitProgress(progress, mode) {
  const next = copyProgress(progress);
  next.player.hp = next.player.maxHp;
  next.player.combo = 0;
  if (mode === 'endless') {
    next.endless.kills = 0;
    next.endless.difficulty = 0;
  } else {
    next.campaign.fight = 0;
  }
  return next;
}

function resolveTurn({
  progress, enemy, correct, elapsedMs, timeLimitSeconds, noDamage = true, mode,
}) {
  let next = copyProgress(progress);
  const target = { ...enemy };
  let damageDealt = 0;
  let damageTaken = 0;
  let status = 'active';
  let earnedXp = 0;
  let rankUp = null;

  if (correct) {
    next.player.combo += 1;
    const combo = next.player.combo;
    const multiplier = combo >= 5 ? 2 : combo >= 3 ? 1.5 : 1;
    const fraction = elapsedMs / (1000 * timeLimitSeconds);
    const speedBonus = Math.max(0, Math.min(5, 10 * (1 - fraction)));
    damageDealt = Math.floor((10 + speedBonus) * multiplier);
    target.hp = Math.max(0, target.hp - damageDealt);
  } else {
    damageTaken = target.attack;
    next.player.hp = Math.max(0, next.player.hp - damageTaken);
    next.player.combo = 0;
    noDamage = false;
  }

  if (next.player.hp === 0) {
    status = 'lost';
    next = forfeitProgress(next, mode);
  } else if (target.hp === 0) {
    status = 'won';
    earnedXp = ENEMY_RULES[target.type].xp + (noDamage ? 5 : 0);
    next.player.xp += earnedXp;
    const rank = getRank(next.player.xp);
    if (next.player.rank !== rank.name) rankUp = rank.name;
    next.player.rank = rank.name;
    next.player.maxHp = rank.maxHp;

    if (mode === 'endless') {
      next.endless.kills += 1;
      next.endless.difficulty = Math.floor(next.endless.kills / 5);
    } else if (target.type === 'boss') {
      const { section } = next.campaign;
      next.campaign.cleared[section] = true;
      next.player.hp = next.player.maxHp;
      if (section === ENEMY_NAMES.length - 1) {
        next.endless.unlocked = true;
      } else {
        next.campaign.section += 1;
        next.campaign.fight = 0;
      }
    } else {
      next.campaign.fight += 1;
    }
  }

  return {
    progress: next, enemy: target, damageDealt, damageTaken, status, earnedXp, rankUp, noDamage,
  };
}

module.exports = { createInitialProgress, getRank, createEnemy, resolveTurn, forfeitProgress };
