// Run manually against the disposable loopback preview. No gameplay API calls are substituted.
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { Pool } = require('pg');
const terms = require('../../db/terms.json');
const { createInitialProgress, getRank } = require('../../server/engine');

const database = new URL(process.env.DATABASE_URL || '');
const preview = new URL(process.env.FIRST_PLAY_PREVIEW_URL || 'http://127.0.0.1:3217');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '55439');
assert.equal(database.pathname, '/first_play_test');
assert.equal(preview.hostname, '127.0.0.1');
const artifacts = process.env.FIRST_PLAY_ARTIFACT_DIR || join(tmpdir(), 'appsec-first-play-qa');
const pool = new Pool({ connectionString: database.href });
const outcomes = [];

async function fixture(username) {
  assert.ok(['bob', 'admin'].includes(username));
  const progress = createInitialProgress();
  progress.player.xp = username === 'bob' ? 120 : 1000;
  const rank = getRank(progress.player.xp);
  Object.assign(progress.player, { rank: rank.name, hp: rank.maxHp, maxHp: rank.maxHp });
  progress.campaign.fight = 6;
  if (username === 'admin') {
    progress.campaign.section = 6;
    progress.campaign.cleared.fill(true);
    progress.endless = { unlocked: true, kills: 4, difficulty: 0 };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    assert.ok(user, 'Seed synthetic test accounts first');
    await client.query("UPDATE battles SET status = 'forfeit', ended_at = now() WHERE user_id = $1 AND status = 'active'", [user.id]);
    await client.query('UPDATE progress SET player=$2,campaign=$3,endless=$4,endless_best_streak=0 WHERE user_id=$1',
      [user.id, progress.player, progress.campaign, progress.endless]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function signIn(browser, username) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => { throw error; });
  await page.goto(preview.href);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(username + '-password-for-tests');
  await page.locator('#view').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Campaign map' }).waitFor();
  return page;
}

async function screenshot(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
  const path = join(artifacts, name + '.png');
  await page.screenshot({ path, fullPage: true });
  console.log('Screenshot: ' + path);
}

async function clickForResponse(page, name, suffix) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith(suffix));
  await page.getByRole('button', { name, exact: true }).click();
  const reply = await response;
  assert.ok(reply.ok(), 'UI request succeeded: ' + suffix + ' (' + reply.status() + ')');
  return reply.json();
}

function solution(question) {
  const term = terms.find(term => question.prompt === 'Name the term: ' + term.definition ||
    question.prompt === 'What is ' + term.term + '?' ||
    question.prompt === 'Which term means: ' + term.definition.replace(/[.!?]+$/, '') + '?' ||
    (term.scenario && question.prompt === term.scenario + ' Which term applies?'));
  assert.ok(term, 'Question matches bundled glossary: ' + question.prompt);
  if (!question.options) return term.term;
  const answer = question.options.indexOf(question.variant === 'reverse' ? term.definition : term.term);
  assert.ok(answer >= 0, 'Correct option exists');
  return answer;
}

async function answer(page, question, correct) {
  const expected = solution(question);
  const response = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/answer'));
  if (question.options) {
    await page.locator('.answer').nth(correct ? expected : (expected + 1) % 4).click();
  } else {
    await page.getByLabel('Your answer').fill(correct ? expected : 'deliberately-wrong-test-answer');
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  }
  const reply = await response;
  assert.equal(reply.status(), 200);
  const body = await reply.json();
  assert.equal(body.correct, correct);
  assert.equal(body.timedOut, false, 'Test answers arrive within the real deadline');
  await page.locator('.feedback h2').waitFor();
  return body;
}

async function continueFeedback(page, body, label = 'Continue') {
  await page.waitForFunction(() => !document.querySelector('.feedback-actions button')?.hasAttribute('aria-disabled'));
  if (body.status === 'active') return clickForResponse(page, label, '/advance');
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function forfeit(page) {
  page.once('dialog', dialog => dialog.accept());
  return clickForResponse(page, 'Forfeit fight', '/forfeit');
}

async function bossDefeatRetry(browser) {
  let completed = false;
  for (let attempt = 0; attempt < 4 && !completed; attempt += 1) {
    await fixture('bob');
    const page = await signIn(browser, 'bob');
    const battle = await clickForResponse(page, 'Challenge boss', '/battles');
    assert.equal(battle.enemy.type, 'boss');
    assert.equal(battle.progress.campaign.fight, 6);
    let question = battle.question;
    let recallSeen = false;
    let wrongSeen = false;
    let body;
    for (let turn = 0; turn < 10; turn += 1) {
      const recall = question.variant === 'recall' && !recallSeen;
      if (recall) {
        await page.getByLabel('Your answer').waitFor();
        await screenshot(page, 'boss-recall-question');
      }
      body = await answer(page, question, recall);
      if (recall) {
        recallSeen = true;
        assert.ok(body.damageDealt > 0);
        await screenshot(page, 'boss-recall-correct-feedback');
      } else if (!wrongSeen) {
        wrongSeen = true;
        assert.ok(body.damageTaken > 0);
        assert.equal(body.progress.player.combo, 0);
        await screenshot(page, 'boss-wrong-feedback');
      }
      if (body.status !== 'active') break;
      question = (await continueFeedback(page, body)).question;
    }
    assert.equal(body.status, 'lost');
    await continueFeedback(page, body, 'See run result');
    await page.getByRole('heading', { name: 'Operator down' }).waitFor();
    assert.equal(await page.getByText('XP kept: 120', { exact: true }).count(), 1);
    await screenshot(page, 'boss-defeat');
    const retry = await clickForResponse(page, 'Retry section', '/battles');
    assert.equal(retry.progress.campaign.fight, 0);
    assert.equal(retry.progress.player.hp, retry.progress.player.maxHp);
    assert.equal(retry.progress.player.xp, 120);
    assert.equal(retry.enemy.type, 'grunt');
    await screenshot(page, 'boss-retry-section-first-fight');
    await forfeit(page);
    await page.close();
    if (recallSeen) {
      outcomes.push('Bob: natural first-boss recall submitted correctly, wrong feedback reset combo, defeat retained 120 XP, Retry section rendered fight one with full HP.');
      completed = true;
    }
  }
  assert.equal(completed, true, 'Observed at least one natural boss recall question');
}

async function endlessTierForfeitLeaderboard(browser) {
  await fixture('admin');
  const page = await signIn(browser, 'admin');
  const battle = await clickForResponse(page, 'Enter endless', '/battles');
  assert.equal(battle.progress.endless.kills, 4);
  assert.equal(battle.progress.endless.difficulty, 0);
  let question = battle.question;
  let body;
  for (let turn = 0; turn < 12; turn += 1) {
    body = await answer(page, question, true);
    if (body.status !== 'active') break;
    question = (await continueFeedback(page, body)).question;
  }
  assert.equal(body.status, 'won');
  assert.equal(body.progress.endless.kills, 5);
  assert.equal(body.progress.endless.difficulty, 1);
  await page.getByText(/Endless.*5 kills.*Tier 1/).waitFor();
  await screenshot(page, 'endless-fifth-kill-tier-one');
  const next = await clickForResponse(page, 'Next enemy', '/battles');
  assert.ok([18, 28].includes(next.question.timeLimitSeconds));
  assert.equal(next.progress.endless.difficulty, 1);
  await screenshot(page, 'endless-tier-one-next-question');
  const ended = await forfeit(page);
  await page.getByRole('heading', { name: 'Endless run complete' }).waitFor();
  assert.equal(ended.runSummary.kills, 5);
  assert.equal(ended.progress.endless.kills, 0);
  assert.equal(ended.progress.player.xp, body.progress.player.xp);
  await screenshot(page, 'endless-forfeit-summary');
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await page.getByRole('heading', { name: 'Endless leaderboard' }).waitFor();
  const row = page.locator('tbody tr').filter({ has: page.getByRole('link', { name: 'admin', exact: true }) });
  await row.waitFor();
  assert.equal(await row.count(), 1);
  assert.ok(Number(await row.locator('td').nth(3).textContent()) >= 5);
  await screenshot(page, 'endless-leaderboard-admin-five-kills');
  outcomes.push('Admin: rendered fifth endless kill changed Tier 0 to Tier 1; Next enemy used a shorter timer; forfeit retained XP and showed five-kill summary; leaderboard displayed admin best kills at least five.');
  await page.close();
}

(async () => {
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    await bossDefeatRetry(browser);
    await endlessTierForfeitLeaderboard(browser);
    outcomes.forEach(outcome => console.log('PASS: ' + outcome));
  } finally { await browser.close(); await pool.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
