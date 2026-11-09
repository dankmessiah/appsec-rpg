'use strict';
const test = global.test || require('node:test');
const assert = require('node:assert/strict');
const terms = [
  { id: 'csrf', section: 0, term: 'CSRF', aliases: ['Cross-Site Request Forgery'], definition: 'Forged browser request', drill_group_ids: ['csrf'] },
  { id: 'long-term', section: 0, term: 'Threat modeling', aliases: ['Threat analysis'], definition: 'Assessing design threats', scenario: 'A team diagrams its trust boundaries.', drill_group_ids: ['threat-modeling'] },
  { id: 'sast', section: 0, term: 'SAST', aliases: [], definition: 'Static code scanning', drill_group_ids: [] },
  { id: 'dast', section: 0, term: 'DAST', aliases: [], definition: 'Runtime testing from outside', drill_group_ids: [] },
  { id: 'xss', section: 1, term: 'XSS', aliases: [], definition: 'Script in a victim browser', drill_group_ids: [] },
];
const campaign = { terms, section: 0, mode: 'campaign', now: 1000 };
const sequence = (...values) => () => values.shift() ?? 0;
const questions = () => require('../../shared/questions');

test('public question strips answer data and creates four unique same-section options', () => {
  const { generateQuestion, publicQuestion } = questions();
  const q = generateQuestion({ ...campaign, rng: () => 0 });
  assert.equal(q.variant, 'definition');
  assert.equal(q.timeLimitSeconds, 20);
  assert.equal(q.startedAt, 1000);
  assert.match(q.id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
  assert.deepEqual([...new Set(q.options)].sort(), ['CSRF', 'DAST', 'SAST', 'Threat modeling']);
  assert.equal(q.options[q.answer], 'CSRF');
  assert.deepEqual(Object.keys(publicQuestion(q)).sort(), ['id', 'options', 'prompt', 'startedAt', 'timeLimitSeconds', 'variant']);
});

test('scenario and reverse variants use available content and sparse sections fall back', () => {
  const { generateQuestion } = questions();
  const scenario = generateQuestion({ ...campaign, rng: sequence(0.3, 0.99) });
  assert.equal(scenario.variant, 'scenario');
  assert.match(scenario.prompt, /trust boundaries/);
  const reverse = generateQuestion({ ...campaign, section: 1, rng: sequence(0, 0.99) });
  assert.equal(reverse.variant, 'reverse');
  assert.equal(new Set(reverse.options).size, 4);
  assert.equal(reverse.options[reverse.answer], terms[4].definition);
});

test('bosses use only drill members and bosses/endless weight unresolved wrong answers', () => {
  const { generateQuestion } = questions();
  const stats = { 'long-term': { wrong: 5, correct: 0 } };
  assert.equal(generateQuestion({ ...campaign, boss: true, rng: () => 0.2 }).termId, 'csrf');
  const boss = generateQuestion({ ...campaign, boss: true, stats, rng: () => 0.2 });
  assert.equal(boss.termId, 'long-term');
  assert.equal(boss.variant, 'recall');
  assert.equal(boss.timeLimitSeconds, 30);
  assert.equal(generateQuestion({ ...campaign, boss: true, rng: () => 0.999 }).termId, 'long-term');
  assert.equal(generateQuestion({ ...campaign, rng: () => 0.9 }).termId, 'dast');
  const endless = generateQuestion({ ...campaign, mode: 'endless', difficulty: 25, stats, rng: () => 0.2 });
  assert.equal(endless.termId, 'long-term');
  assert.equal(endless.timeLimitSeconds, 12);
  assert.equal(generateQuestion({ ...campaign, mode: 'endless', difficulty: 25, rng: () => 0.9 }).timeLimitSeconds, 8);
});

test('typed answers normalize aliases and allow one typo only for long expected strings', () => {
  const { generateQuestion, checkAnswer } = questions();
  const q = generateQuestion({ ...campaign, boss: true, rng: () => 0 });
  assert.equal(checkAnswer(q, { text: ' CROSS-site Request, Forgery! ' }, 1000).correct, true);
  assert.equal(checkAnswer(q, { text: 'Cross-site Request Forgary' }, 1000).correct, true);
  assert.equal(checkAnswer(q, { text: 'CRSF' }, 1000).correct, false);
  assert.equal(checkAnswer(q, { text: 'CSRFs' }, 1000).correct, false);
  assert.equal(checkAnswer(q, { text: 'Cross-side Requost Forgery' }, 1000).correct, false);
  assert.equal(checkAnswer(q, { text: 'CSRF' }, 33000).correct, true);
  assert.deepEqual(checkAnswer(q, { text: 'CSRF' }, 33001), {
    correct: false, timedOut: true, elapsedMs: 32001, correctAnswer: 'CSRF', explanation: terms[0].definition,
  });
});

test('MC indices must be numeric integers in range, and grace applies at the boundary', () => {
  const { generateQuestion, checkAnswer } = questions();
  const q = generateQuestion({ ...campaign, rng: () => 0 });
  for (const choice of [-1, 4, 1.5, String(q.answer), null]) {
    assert.equal(checkAnswer(q, { choice }, 1000).correct, false);
  }
  assert.equal(checkAnswer(q, { choice: q.answer }, 23000).correct, true);
  assert.equal(checkAnswer(q, { choice: q.answer }, 23001).correct, false);
  assert.equal(checkAnswer(q, { choice: q.answer }, 23001).correctAnswer, 'CSRF');
});
