const apiRoot = '/api/v1';
const sections = [
  'Testing Types And Tooling',
  'Vulnerability Classes',
  'Web, Auth And Identity',
  'Standards And Frameworks',
  'Risk Scoring And Prioritization',
  'Supply Chain And CI/CD',
  'Program And Process'
];
const rankThresholds = [0, 150, 400, 800, 1400];

const view = document.querySelector('#view');
const navigation = document.querySelector('#navigation');
const notice = document.querySelector('#notice');
const publicId = new URLSearchParams(location.search).get('player');
const state = {
  screen: 'loading',
  authMode: 'login',
  session: null,
  progress: null,
  battle: null,
  result: null,
  practice: null,
  busy: false
};
let timerReadout;
let continueButton;
let unlockHint;

function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  node.append(...children.filter(child => child != null && child !== false));
  return node;
}

function button(text, action, variant = '', attrs = {}) {
  const node = element('button', {
    className: ['action', variant].filter(Boolean).join(' '),
    text,
    attrs: { type: 'button', ...attrs }
  });
  if (action) node.addEventListener('click', action);
  return node;
}

function heading(title, subtitle, label) {
  return element('div', {},
    label && element('p', { className: 'terminal-label', text: label }),
    element('h1', { text: title, attrs: { tabindex: '-1' } }),
    subtitle && element('p', { className: 'lede', text: subtitle }));
}

function sprite(id, className = '') {
  const image = element('img', {
    className,
    attrs: { src: '/assets/' + id + '.png', alt: '', width: 320, height: 320 }
  });
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  return image;
}

function bar(id, label, value, max, display, className = '') {
  const meter = element('progress', { attrs: { id, value, max } });
  const text = element('span', { className: 'measure', text: display });
  const title = element('label', { attrs: { for: id } }, label, ' ', text);
  return { meter, text, node: element('div', { className: 'readout ' + className }, title, meter) };
}

function xpReadout(player) {
  const next = rankThresholds.find(threshold => threshold > player.xp);
  const lower = rankThresholds.findLast(threshold => threshold <= player.xp);
  return bar('xp', 'XP', next ? player.xp - lower : 1, next ? next - lower : 1,
    next ? player.xp + ' / ' + next : player.xp + ' · Max Rank', 'xp').node;
}

class HttpError extends Error {
  constructor(status) {
    super('HTTP ' + status);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, protect = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && protect && state.session) {
    headers['X-CSRF-Token'] = state.session.csrfToken;
  }
  const response = await fetch(apiRoot + path, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const error = new HttpError(response.status);
    error.protectedRoute = protect;
    throw error;
  }
  if (response.status !== 204) return response.json();
}

function errorMessage(error) {
  switch (error.status) {
    case 400: return 'Check Your Input And Try Again';
    case 401: return 'The Username Or Password Is Incorrect';
    case 403: return 'This Action Was Denied. Refresh The Page If Your Session Changed.';
    case 404: return 'This Record Is Unavailable';
    case 409: return state.screen === 'auth'
      ? 'That Username Or Email Is Already In Use'
      : 'The Game State Changed. Return To The Campaign Map And Try Again.';
    case 429: return 'Too Many Requests. Wait A Moment Before Trying Again.';
    default: return 'Could Not Complete The Request. Check Your Connection And Try Again.';
  }
}

function resetSession() {
  state.session = null;
  state.progress = null;
  state.battle = null;
  state.result = null;
  state.authMode = 'login';
}

async function perform(operation) {
  if (state.busy) return;
  state.busy = true;
  view.setAttribute('aria-busy', 'true');
  notice.textContent = '';
  try {
    await operation();
  } catch (error) {
    if (error.status === 401 && error.protectedRoute) {
      resetSession();
      show('auth');
      notice.textContent = 'Your Session Has Expired. Sign In To Continue.';
    } else {
      notice.textContent = errorMessage(error);
    }
  } finally {
    state.busy = false;
    view.removeAttribute('aria-busy');
  }
}

function show(screen, data) {
  state.screen = screen;
  timerReadout = null;
  continueButton = null;
  unlockHint = null;
  const screens = {
    auth: renderAuth,
    map: renderMap,
    battle: renderBattle,
    practice: renderFirstPlay,
    defeat: renderDefeat,
    weak: renderWeak,
    leaderboard: renderLeaderboard,
    public: renderPublic
  };
  view.replaceChildren(screens[screen](data));
  renderNavigation();
  updateClocks();
  view.querySelector('h1')?.focus();
}

async function loadMap() {
  const { battle } = await api('/battles/current');
  if (battle) {
    state.progress = battle.progress;
    state.battle = battle;
    state.result = battle.result ? { ...battle.result, unlockAt: performance.now() + (battle.result.correct ? 0 : 3000) } : null;
    show('battle');
    return;
  }
  state.progress = await api('/progress');
  state.battle = null;
  state.result = null;
  show('map');
}

async function loadLeaderboard() {
  show('leaderboard', await api('/leaderboard', { protect: false }));
}

function renderNavigation() {
  navigation.replaceChildren();
  if (state.screen === 'battle') return;
  if (publicId) {
    navigation.append(element('a', { text: 'Game Home', className: 'action quiet', attrs: { href: '/' } }));
  } else if (state.session) {
    navigation.append(
      button('Campaign', () => perform(loadMap), 'quiet', current('map')),
      button('Weak Spots', () => perform(async () => show('weak', await api('/weak-spots'))),
        'quiet', current('weak'))
    );
  } else {
    navigation.append(button('Sign In', () => {
      if (state.busy) return;
      notice.textContent = '';
      show('auth');
    }, 'quiet', current('auth')));
  }
  navigation.append(button('Leaderboard', () => perform(loadLeaderboard),
    'quiet', current('leaderboard')));
  if (state.session) {
    navigation.append(button('Sign Out', () => perform(async () => {
      await api('/auth/logout', { method: 'POST' });
      resetSession();
      show('auth');
    }), 'quiet'));
  }
}

function current(screen) {
  return state.screen === screen ? { 'aria-current': 'page' } : {};
}

function inputField(label, attrs) {
  const input = element('input', { attrs: { required: '', ...attrs } });
  return element('label', { className: 'field' }, label, input);
}

function renderAuth() {
  const register = state.authMode === 'register';
  const brief = element('section', { className: 'auth-brief' },
    heading('Defend The Stack', 'Learn Application Security By Fighting Threats Across Seven Training Sectors', 'Operator Console'),
    sprite('player_idle'));
  const card = element('section', { className: 'panel auth-card' },
    element('h2', { text: register ? 'Create An Account' : 'Operator Sign-In' }));
  const form = element('form', { className: 'stack' },
    inputField('Username', { name: 'username', autocomplete: 'username', minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_\\-]{3,20}', title: 'Use 3 To 20 Letters, Digits, Underscores, Or Hyphens' }),
    register && inputField('Email', { name: 'email', type: 'email', autocomplete: 'email', maxlength: 254 }),
    inputField('Password', {
      name: 'password',
      type: 'password',
      autocomplete: register ? 'new-password' : 'current-password',
      ...(register ? { minlength: 12, 'aria-describedby': 'password-hint' } : {})
    }),
    register && element('span', { className: 'hint', text: 'Use At Least 12 Characters', attrs: { id: 'password-hint' } }),
    button(register ? 'Create Account' : 'Sign In', null, 'primary', { type: 'submit' })
  );
  form.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const body = Object.fromEntries(new FormData(form));
      state.session = await api(register ? '/auth/register' : '/auth/login',
        { method: 'POST', body, protect: false });
      try {
        await loadMap();
      } catch (error) {
        if (error.status !== 401) showLoadError(loadMap);
        throw error;
      }
    });
  });
  const swap = button(register ? 'Sign In Instead' : 'Create An Account', () => {
    if (state.busy) return;
    state.authMode = register ? 'login' : 'register';
    notice.textContent = '';
    show('auth');
    view.querySelector('input')?.focus();
  }, 'quiet');
  card.append(form, element('p', { className: 'switch' }, swap));
  return element('div', { className: 'auth-layout' }, brief, card);
}

function renderMap() {
  const { player, campaign, endless } = state.progress;
  const allCleared = campaign.cleared.every(Boolean);
  const track = element('ol', { className: 'sector-track' });
  for (const [index, name] of sections.entries()) {
    const cleared = campaign.cleared[index];
    const available = !cleared && index === campaign.section;
    const sector = element('li', { className: 'sector ' + (cleared ? 'cleared' : available ? 'current' : 'locked') },
      element('span', { className: 'sector-number', text: String(index + 1).padStart(2, '0'), attrs: { 'aria-hidden': 'true' } }));
    const status = cleared ? 'Cleared' : available ? 'Current Sector · Fight ' + (campaign.fight + 1) + ' Of 7' : 'Locked';
    const details = element('div', {},
      element('h2', { text: name }),
      element('span', { className: 'sector-status', text: status }));
    if (available) {
      details.append(element('div', { className: 'actions' },
        button(campaign.fight === 6 ? 'Challenge Boss' : 'Start Fight', () => startBattle('campaign'), 'primary'),
        campaign.fight === 6 && element('span', { className: 'boss-note', text: 'Boss Encounter' })));
    }
    sector.append(details);
    track.append(sector);
  }
  const operator = element('section', { className: 'panel operator' },
    element('p', { className: 'terminal-label', text: state.session.user.username }),
    element('h2', { text: player.rank }),
    sprite(allCleared ? 'player_victory' : 'player_idle'),
    xpReadout(player),
    button('Replay First-Fight Practice', openFirstPlay, 'quiet'),
    element('p', { className: 'measure', text: 'HP ' + player.hp + ' / ' + player.maxHp }));
  const endlessCard = element('section', { className: 'panel endless-card' },
    element('h2', { text: 'Endless Arena' }),
    element('p', { className: 'lede', text: endless.unlocked
      ? 'Face Random Enemies. Every Five Kills Raises The Difficulty.'
      : 'Clear All Seven Sectors To Unlock Endless Runs' }),
    button(endless.unlocked ? 'Enter Endless' : 'Endless Locked', () => startBattle('endless'), 'primary',
      endless.unlocked ? {} : { disabled: '' }));
  return element('div', {},
    heading('Campaign Map', allCleared ? 'All Seven Sectors Cleared' : 'Clear Each Sector To Advance Through The Campaign'),
    element('div', { className: 'map-layout' }, track, element('div', { className: 'stack' }, operator, endlessCard)));
}

const dismissedFirstPlay = new Set();
function firstPlayKey() { return 'appsec-first-play:' + state.session.user.id; }
function needsFirstPlay() {
  const { player, campaign } = state.progress;
  if (player.xp > 0 || campaign.section > 0 || campaign.fight > 0 || campaign.cleared.some(Boolean)) return false;
  if (dismissedFirstPlay.has(firstPlayKey())) return false;
  try { return localStorage.getItem(firstPlayKey()) !== 'done'; } catch { return true; }
}
function dismissFirstPlay() {
  dismissedFirstPlay.add(firstPlayKey());
  try { localStorage.setItem(firstPlayKey(), 'done'); } catch { /* Storage may be disabled. */ }
}
function openFirstPlay() {
  state.practice = { phase: 'intro', correct: null };
  show('practice');
}
function answerPractice(choice) {
  state.practice.correct = choice === 0;
  show('practice');
}
function finishPractice() {
  dismissFirstPlay();
  state.practice = { phase: 'ready', correct: null };
  show('practice');
}
function renderFirstPlay() {
  const practice = state.practice;
  const intro = element('section', { className: 'panel console practice' },
    heading('Before Your First Fight', 'Practice Is Untimed. It Does Not Change HP, Combo, XP Or Campaign Progress.'),
    element('p', { text: 'Real Fights Have A Timer For Each Question. Correct Answers Deal Damage; Faster Answers Hit Harder. Wrong Answers Or Timeouts Cost HP And Reset Your Combo.' }),
    element('p', { text: 'Consecutive Correct Answers Build Your Combo. Defeating Enemies Awards XP And Can Raise Your Rank. If You Lose All HP Or Forfeit, Your Current Section Restarts At Fight One. Earned XP Is Kept.' }),
    element('p', { text: 'After An Answer, Take As Long As You Need To Read The Feedback. The Next Timer Begins Only When You Choose Continue. Wrong-Answer Feedback Has A Brief Reading Pause.' }));
  if (practice.phase === 'ready') {
    intro.append(element('h2', { text: 'Ready When You Are' }),
      element('p', { text: state.progress.campaign.cleared.every(Boolean)
        ? 'Campaign Complete. Return To The Map To Enter Endless Mode.'
        : 'The Real Timer Starts When You Begin The Fight' }),
      element('div', { className: 'actions' },
        !state.progress.campaign.cleared.every(Boolean) && button('Begin Real Fight', () => startBattle('campaign', true), 'primary'),
        button('Back To Campaign', () => show('map'), 'quiet')));
  } else if (practice.phase === 'intro') {
    intro.append(element('div', { className: 'actions' },
      button('Try Untimed Practice', () => { state.practice.phase = 'question'; show('practice'); }, 'primary'),
      button('Skip Practice', finishPractice, 'quiet')));
  } else {
    intro.append(element('h2', { text: 'A tool reviews source code before the application runs. Which test is this?' }));
    const answers = element('div', { className: 'answers' });
    ['SAST', 'DAST', 'Container image scanning', 'Secrets scanning'].forEach((text, choice) => {
      answers.append(button(text, () => answerPractice(choice), 'answer'));
    });
    intro.append(answers);
    if (practice.correct !== null) {
      intro.append(element('div', { className: 'panel feedback ' + (practice.correct ? '' : 'wrong'), attrs: { role: 'status' } },
        element('h2', { text: practice.correct ? 'Correct: SAST' : 'Try Again: Check What The Tool Inspects' }),
        element('p', { text: 'SAST examines source code without running the application. Example: a rule finds unsafe SQL string concatenation in a pull request. DAST sends requests to a running application. Container scanning examines packaged components; secrets scanning looks for exposed credentials.' })));
    }
    intro.append(element('div', { className: 'actions' },
      practice.correct && button('Finish Practice', finishPractice, 'primary'),
      button('Skip Practice', finishPractice, 'quiet')));
  }
  return intro;
}

function startBattle(mode, introduced = false) {
  if (mode === 'campaign' && !introduced && needsFirstPlay()) { openFirstPlay(); return; }
  return perform(async () => {
    try {
      const battle = await api('/battles', { method: 'POST', body: { mode, replaceActive: false } });
      state.progress = battle.progress;
      state.battle = { ...battle, mode };
      state.result = null;
      show('battle');
    } catch (error) {
      if (error.status !== 409) throw error;
      await loadMap();
      notice.textContent = 'Your Saved Fight And Progress Have Been Restored';
    }
  });
}

function submitAnswer(answer) {
  return perform(async () => {
    const battle = state.battle;
    if (!battle?.question || state.result) return;
    const { id, question } = battle;
    try {
      const result = await api('/battles/' + encodeURIComponent(id) + '/answer', {
        method: 'POST',
        body: { questionId: question.id, ...answer }
      });
      state.progress = result.progress;
      state.battle = { ...battle, enemy: result.enemy, question: result.question, answeredQuestionId: question.id };
      state.result = { ...result, unlockAt: performance.now() + (result.correct ? 0 : 3000) };
      show('battle');
      continueButton?.focus();
    } catch (error) {
      if (error.status !== 409 && error.status !== 404) throw error;
      await loadMap();
      notice.textContent = 'Your Saved Fight And Progress Have Been Restored';
    }
  });
}

function fighter({ title, type, image, label, hp, maxHp, enemy = false }) {
  return element('div', { className: enemy ? 'fighter enemy' : 'fighter' },
    sprite(image, 'fighter-art'),
    element('h2', { text: title }),
    bar(enemy ? 'enemy-hp' : 'player-hp', label, hp, maxHp, hp + ' / ' + maxHp).node,
    element('span', { className: 'measure', text: type }));
}

function renderBattle() {
  const { enemy, mode, question } = state.battle;
  const { player, campaign, endless } = state.progress;
  const result = state.result;
  const pose = result?.status === 'won' ? 'victory' : result?.correct ? 'attack' : result ? 'hurt' : 'idle';
  const battleLabel = mode === 'endless' ? 'Endless · ' + endless.kills + ' Kills · Tier ' + endless.difficulty :
    'Campaign · ' + sections[enemy.section];
  const top = heading(enemy.name, null, battleLabel);
  top.className = 'battle-head';
  const arena = element('div', { className: 'arena ' + (result ? (result.correct ? 'hit' : 'hurt') : '') },
    fighter({
      title: state.session.user.username, type: 'Combo ×' + player.combo,
      image: 'player_' + pose, label: 'Player HP',
      hp: result?.status === 'lost' ? 0 : player.hp, maxHp: player.maxHp
    }),
    fighter({
      title: enemy.name, type: enemy.type, image: 's' + enemy.section + '_' + enemy.type,
      label: 'Enemy HP', hp: enemy.hp, maxHp: enemy.maxHp, enemy: true
    }));
  const consolePanel = element('section', { className: 'panel console' });
  if (question && !result) {
    timerReadout = bar('question-time', result ? 'Next Question' : 'Time Remaining',
      question.timeLimitSeconds, question.timeLimitSeconds, '', 'timer');
    consolePanel.append(timerReadout.node);
  }
  if (result) {
    consolePanel.append(renderFeedback(result, mode));
  } else {
    consolePanel.append(renderQuestion(question));
  }
  const canForfeit = !result || result.status === 'active';
  return element('div', {}, top, arena, consolePanel,
    canForfeit && element('div', { className: 'fight-controls' },
      button('Forfeit Fight', forfeit, 'quiet danger')),
    !result && mode === 'campaign' &&
      element('p', { className: 'hint', text: 'Fight ' + (campaign.fight + 1) + ' Of 7' }));
}

function renderQuestion(question) {
  const container = element('div', {},
    element('h2', { text: question.prompt, attrs: { id: 'question-prompt', tabindex: '-1' } }));
  if (Array.isArray(question.options)) {
    const choices = element('div', {
      className: 'answers', attrs: { role: 'group', 'aria-labelledby': 'question-prompt' }
    });
    for (const [choice, text] of question.options.entries()) {
      const answer = button('', () => submitAnswer({ choice }), 'answer', { 'data-choice': choice });
      answer.append(element('kbd', { text: choice + 1, attrs: { 'aria-hidden': 'true' } }), element('span', { text }));
      choices.append(answer);
    }
    container.append(choices, element('p', { className: 'hint', text: 'Use Keys 1 To 4 Or Select An Answer' }));
  } else {
    const form = element('form', { className: 'stack' },
      inputField('Your Answer', { name: 'text', maxlength: 250, autocomplete: 'off', spellcheck: 'false' }),
      element('div', { className: 'actions' }, button('Submit Answer', null, 'primary', { type: 'submit' })));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const text = new FormData(form).get('text').trim();
      if (text) submitAnswer({ text });
    });
    container.append(form);
  }
  return container;
}

function renderFeedback(result, mode) {
  const title = result.timedOut ? 'Time Expired' : result.correct ? 'Correct Answer' : 'Incorrect Answer';
  const damage = result.correct
    ? result.damageDealt + ' Damage Dealt'
    : result.damageTaken + ' Damage Taken. Combo Reset.';
  const feedback = element('div', {},
    element('div', { className: 'panel feedback ' + (result.correct ? '' : 'wrong'), attrs: { role: 'status' } },
      element('h2', { text: title }),
      element('p', { text: damage }),
      element('p', {}, 'Answer: ', element('strong', { text: result.correctAnswer })),
      element('p', { text: result.explanation })));
  if (result.status === 'won') {
    feedback.append(element('p', { text: 'Enemy Defeated. +' + result.earnedXp + ' XP' }));
    if (result.rankUp) {
      feedback.append(element('p', { text: 'Rank Up: ' + state.progress.player.rank }));
    }
    feedback.append(xpReadout(state.progress.player));
  }
  const label = result.status === 'lost' ? 'See Run Result' :
    result.status === 'won' ? (mode === 'endless' ? 'Next Enemy' : 'Back To Map') : 'Continue';
  continueButton = button(label, advance, 'primary', result.correct ? {} : { 'aria-disabled': 'true' });
  unlockHint = element('span', { className: 'hint' });
  feedback.append(element('div', { className: 'actions feedback-actions' }, continueButton, unlockHint));
  return feedback;
}

function advance() {
  const result = state.result;
  if (state.busy || !result || performance.now() < result.unlockAt) return;
  const { mode, enemy } = state.battle;
  if (result.status === 'lost') {
    state.battle = null;
    state.result = null;
    show('defeat', { mode, enemy, runSummary: result.runSummary });
  } else if (result.status === 'won') {
    if (mode === 'endless') startBattle(mode);
    else perform(loadMap);
  } else {
    return perform(async () => {
      try {
        const { question } = await api('/battles/' + encodeURIComponent(state.battle.id) + '/advance', {
          method: 'POST', body: { questionId: state.battle.answeredQuestionId }
        });
        state.battle.question = question;
        state.result = null;
        show('battle');
        view.querySelector('#question-prompt')?.focus();
      } catch (error) {
        if (error.status !== 409 && error.status !== 404) throw error;
        await loadMap();
        notice.textContent = 'Your Saved Fight And Progress Have Been Restored';
      }
    });
  }
}

function forfeit() {
  if (state.busy || !state.battle) return;
  if (!window.confirm('Forfeit This Fight And Restart Your Section Or Endless Run?')) return;
  perform(async () => {
    const { id, mode, enemy } = state.battle;
    try {
      const outcome = await api('/battles/' + encodeURIComponent(id) + '/forfeit', { method: 'POST' });
      state.progress = outcome.progress;
      state.battle = null;
      state.result = null;
      show('defeat', { mode, enemy, runSummary: outcome.runSummary, forfeited: true });
    } catch (error) {
      if (error.status !== 409 && error.status !== 404) throw error;
      await loadMap();
      notice.textContent = 'This Fight Is No Longer Active. The Map Shows Your Saved Progress.';
    }
  });
}

function renderDefeat({ mode, enemy, runSummary, forfeited }) {
  const endless = mode === 'endless';
  const title = endless ? 'Endless Run Complete' : forfeited ? 'Fight Forfeited' : 'Operator Down';
  const description = forfeited ? 'You Left The Fight Against ' + enemy.name : enemy.name + ' Defeated Your Operator';
  return element('section', { className: 'panel defeat' },
    heading(title, description),
    sprite('player_hurt', 'aftermath'),
    element('p', { text: 'XP Kept: ' + state.progress.player.xp }),
    endless && runSummary && statsList([
      ['Enemies Defeated', runSummary.kills],
      ['Best Streak This Run', runSummary.bestStreak]
    ]),
    !endless && element('p', { className: 'muted', text: 'Your Section Restarts At Fight 1 With Full HP' }),
    element('div', { className: 'actions' },
      button(endless ? 'Start Another Run' : 'Retry Section', () => startBattle(mode), 'primary'),
      button('Back To Map', () => perform(loadMap))));
}

function table(headers, rows, caption) {
  const titles = headers.map(text => element('th', { text, attrs: { scope: 'col' } }));
  const body = rows.map(row => element('tr', {}, ...row.map(value =>
    value instanceof Node ? element('td', {}, value) : element('td', { text: value }))));
  return element('div', { className: 'table-wrap', attrs: { tabindex: '0', role: 'region', 'aria-label': caption } },
    element('table', {}, element('thead', {}, element('tr', {}, ...titles)), element('tbody', {}, ...body)));
}

function renderWeak({ terms }) {
  return element('section', {},
    heading('Weak Spots', 'Review The Terms You Miss Most Often'),
    terms.length
      ? table(['Term', 'Sector', 'Correct', 'Wrong', 'Definition'], terms.slice(0, 15).map(term => [
        term.term, sections[term.section], term.correct, term.wrong, term.definition
      ]), 'Weak Spots Table')
      : element('p', { text: 'Missed Terms Will Appear Here After Your Battles' }));
}

function renderLeaderboard({ entries }) {
  return element('section', {},
    heading('Endless Leaderboard', 'Top Operators Ranked By Their Best Endless Runs'),
    entries.length
      ? table(['Place', 'Operator', 'Rank', 'Best Kills', 'Best Streak'], entries.slice(0, 20).map((entry, index) => [
        index + 1,
        element('a', { text: entry.username, attrs: { href: '/?player=' + encodeURIComponent(entry.userId) } }),
        entry.rank, entry.bestKills, entry.bestStreak
      ]), 'Endless Leaderboard Table')
      : element('p', { text: 'No Endless Runs Have Been Recorded Yet' }));
}

function statsList(stats) {
  return element('dl', { className: 'public-stats' }, ...stats.map(([label, value]) =>
    element('div', {}, element('dt', { text: label }), element('dd', { text: value }))));
}

function renderPublic({ username, rank, bestKills, sectionsCleared }) {
  return element('section', {},
    heading(username, null, 'Public Operator Record'),
    statsList([['Rank', rank], ['Best Endless Kills', bestKills], ['Sectors Cleared', sectionsCleared + ' / 7']]),
    button('Back To Leaderboard', () => perform(loadLeaderboard)));
}

function updateClocks() {
  if (timerReadout && state.battle?.question) {
    const { startedAt, timeLimitSeconds } = state.battle.question;
    const remaining = Math.min(timeLimitSeconds, Math.max(0, timeLimitSeconds - (Date.now() - startedAt) / 1000));
    const label = remaining > 0 ? Math.ceil(remaining) + 's' : '0s · Expired';
    timerReadout.meter.value = remaining;
    timerReadout.meter.classList.toggle('warning', remaining <= 5);
    if (timerReadout.text.textContent !== label) timerReadout.text.textContent = label;
  }
  if (continueButton && state.result) {
    const delay = Math.max(0, Math.ceil((state.result.unlockAt - performance.now()) / 1000));
    const label = delay > 0 ? 'Available In ' + delay + 's' : 'Enter To Continue';
    if (delay === 0) continueButton.removeAttribute('aria-disabled');
    if (unlockHint.textContent !== label) unlockHint.textContent = label;
  }
}

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      event.shiftKey || state.screen !== 'battle' || state.busy) return;
  if (event.target.closest('input, textarea, select, a, [contenteditable]')) return;
  if (event.key === 'Enter' && state.result && !event.target.closest('button')) {
    event.preventDefault();
    advance();
  } else if (/^[1-4]$/.test(event.key) && !state.result) {
    const answer = view.querySelector('[data-choice="' + (Number(event.key) - 1) + '"]');
    if (answer) {
      event.preventDefault();
      answer.click();
    }
  }
});

async function initialize() {
  try {
    state.session = await api('/auth/me');
  } catch (error) {
    if (error.status !== 401 && !publicId) throw error;
  }
  if (publicId) {
    show('public', await api('/users/' + encodeURIComponent(publicId) + '/stats', { protect: false }));
  } else if (state.session) {
    await loadMap();
  } else {
    show('auth');
  }
}

function showLoadError(retry) {
  state.screen = 'loading';
  view.replaceChildren(
    heading('Game Unavailable', 'Check Your Connection Or Open The Leaderboard'),
    button('Try Again', () => perform(retry), 'primary'),
    button('Leaderboard', () => perform(loadLeaderboard), 'quiet')
  );
  renderNavigation();
  view.querySelector('h1')?.focus();
}

async function boot() {
  await perform(initialize);
  if (state.screen === 'loading') showLoadError(initialize);
}

setInterval(updateClocks, 125);
boot();
