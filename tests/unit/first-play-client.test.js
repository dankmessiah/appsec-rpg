const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function client() {
  const node = { setAttribute() {}, removeAttribute() {}, querySelector() {} };
  const context = vm.createContext({ document: { querySelector: () => node, addEventListener() {} },
    location: { search: '' }, URLSearchParams, performance: { now: () => 10000 }, setInterval() {},
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn() } });
  vm.runInContext(readFileSync(join(__dirname, '../../public/app.js'), 'utf8').replace(/boot\(\);\s*$/, ''), context);
  vm.runInContext(`show = screen => { state.screen = screen; }; state.session = { user: { id: 7 } };
    state.progress = { player: { xp: 0, hp: 100 }, campaign: { section: 0, fight: 0, cleared: [false] } };`, context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('first-play dismissal is per user and tolerates blocked storage; advanced users bypass introduction', () => {
  const { context, run } = client();
  expect(run('needsFirstPlay()')).toBe(true);
  run('dismissFirstPlay()');
  expect(context.localStorage.setItem).toHaveBeenCalledWith('appsec-first-play:7', 'done');
  context.localStorage.getItem.mockImplementation(() => { throw new Error('blocked'); });
  context.localStorage.setItem.mockImplementation(() => { throw new Error('blocked'); });
  expect(() => run('dismissFirstPlay()')).not.toThrow();
  run('state.progress.player.xp = 10');
  expect(run('needsFirstPlay()')).toBe(false);
});

test('untimed practice wrong answers allow retry; completion and skip never mutate API or player progress', () => {
  const { context, run } = client();
  context.fetch = jest.fn(() => { throw new Error('practice must be local'); });
  const progress = run('JSON.stringify(state.progress)');
  run('openFirstPlay(); answerPractice(1)');
  expect(run('state.practice.correct')).toBe(false);
  run('answerPractice(0)');
  expect(run('state.practice.correct')).toBe(true);
  run('finishPractice()');
  expect(run('state.practice.phase')).toBe('ready');
  run('openFirstPlay(); finishPractice()');
  expect(run('state.practice.phase')).toBe('ready');
  expect(run('JSON.stringify(state.progress)')).toBe(progress);
  expect(context.fetch).not.toHaveBeenCalled();
});

test('Continue preserves feedback on network failure, then retries the same answered question', async () => {
  const { context, run } = client();
  run(`state.battle = { id: 'battle', mode: 'campaign', question: null, answeredQuestionId: 'previous' };
    state.result = { status: 'active', unlockAt: 0 };`);
  context.fetch = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, status: 200,
    json: async () => ({ question: { id: 'next', startedAt: 123, timeLimitSeconds: 20 } }) });
  await run('advance()');
  expect(run('state.result.status')).toBe('active');
  expect(run('state.battle.answeredQuestionId')).toBe('previous');
  await run('advance()');
  expect(run('state.result')).toBeNull();
  expect(run('state.battle.question.id')).toBe('next');
  expect(context.fetch.mock.calls[0][0]).toContain('/battle/advance');
  expect(context.fetch.mock.calls[1][1].body).toBe(JSON.stringify({ questionId: 'previous' }));
});


test('completed campaign practice replay offers map return without an invalid real-fight action', () => {
  const { run } = client();
  run(`element = (tag, options = {}, ...children) => ({ tag, ...options, children,
    append(...items) { this.children.push(...items); } });
    button = text => ({ text }); heading = text => ({ text });
    state.progress.campaign.cleared = [true, true, true, true, true, true, true];
    openFirstPlay(); finishPractice();`);
  expect(run('JSON.stringify(renderFirstPlay())')).not.toContain('Begin Real Fight');
  expect(run('JSON.stringify(renderFirstPlay())')).toContain('Back To Campaign');
});


test('load restores an active question or saved feedback rather than abandoning it', async () => {
  const { context, run } = client();
  const battle = { id: 'saved', mode: 'campaign', question: { id: 'original', startedAt: 100 },
    progress: { player: { xp: 0 } }, result: null };
  context.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ battle }) });
  await run('loadMap()');
  expect(run('state.screen')).toBe('battle');
  expect(run('state.battle.question.startedAt')).toBe(100);
  battle.question = null;
  battle.answeredQuestionId = 'original';
  battle.result = { status: 'active', correct: false, correctAnswer: 'SAST' };
  context.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ battle }) });
  await run('loadMap()');
  expect(run('state.result.correctAnswer')).toBe('SAST');
  expect(run('state.battle.answeredQuestionId')).toBe('original');
});

test('lost start response followed by a safe-start conflict restores the existing fight', async () => {
  const { context, run } = client();
  run('state.progress.player.xp = 10');
  context.fetch = jest.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ ok: false, status: 409 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ battle: { id: 'existing', mode: 'campaign',
      question: { id: 'original', startedAt: 100 }, result: null, progress: { player: { xp: 10 } } } }) });
  await run("startBattle('campaign')");
  await run("startBattle('campaign')");
  expect(run('state.battle.id')).toBe('existing');
  expect(run('state.screen')).toBe('battle');
  expect(context.fetch.mock.calls[1][1].body).toContain('"replaceActive":false');
});


test('stale cross-tab Continue restores authoritative state rather than trapping old feedback', async () => {
  const { context, run } = client();
  run(`state.battle = { id: 'battle', mode: 'campaign', question: null, answeredQuestionId: 'old' };
    state.result = { status: 'active', unlockAt: 0 };`);
  context.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 409 }).mockResolvedValueOnce({ ok: true, status: 200,
    json: async () => ({ battle: { id: 'battle', mode: 'campaign', result: null, question: { id: 'current', startedAt: 123 }, progress: {} } }) });
  await run('advance()');
  expect(run('state.battle.question.id')).toBe('current');
  expect(run('state.result')).toBeNull();
});

test('lost answer response retry restores resolved feedback without losing the answered identity', async () => {
  const { context, run } = client();
  run(`state.battle = { id: 'battle', mode: 'campaign', question: { id: 'answered' } };`);
  context.fetch = jest.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ ok: false, status: 409 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ battle: { id: 'battle', mode: 'campaign', question: null,
      answeredQuestionId: 'answered', result: { status: 'active', correct: true, correctAnswer: 'SAST' }, progress: {} } }) });
  await run('submitAnswer({ choice: 0 })');
  await run('submitAnswer({ choice: 0 })');
  expect(run('state.result.correctAnswer')).toBe('SAST');
  expect(run('state.battle.answeredQuestionId')).toBe('answered');
});
