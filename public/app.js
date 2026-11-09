const apiRoot = '/api/v1';
const sections = [
  'Testing types and tooling',
  'Vulnerability classes',
  'Web, auth and identity',
  'Standards and frameworks',
  'Risk scoring and prioritization',
  'Supply chain and CI/CD',
  'Program and process'
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
    next ? player.xp + ' / ' + next : player.xp + ' · Max rank', 'xp').node;
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
    case 400: return 'Check your input and try again.';
    case 401: return 'The username or password is incorrect.';
    case 403: return 'This action was denied. Refresh the page if your session changed.';
    case 404: return 'This record is unavailable.';
    case 409: return state.screen === 'auth'
      ? 'That username or email is already in use.'
      : 'The game state changed. Return to the campaign map and try again.';
    case 429: return 'Too many requests. Wait a moment before trying again.';
    default: return 'Could not complete the request. Check your connection and try again.';
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
      notice.textContent = 'Your session has expired. Sign in to continue.';
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
    navigation.append(element('a', { text: 'Game home', className: 'action quiet', attrs: { href: '/' } }));
  } else if (state.session) {
    navigation.append(
      button('Campaign', () => perform(loadMap), 'quiet', current('map')),
      button('Weak spots', () => perform(async () => show('weak', await api('/weak-spots'))),
        'quiet', current('weak'))
    );
  } else {
    navigation.append(button('Sign in', () => {
      if (state.busy) return;
      notice.textContent = '';
      show('auth');
    }, 'quiet', current('auth')));
  }
  navigation.append(button('Leaderboard', () => perform(loadLeaderboard),
    'quiet', current('leaderboard')));
  if (state.session) {
    navigation.append(button('Sign out', () => perform(async () => {
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
    heading('Defend the stack.', 'Learn application security by fighting threats across seven training sectors.', 'Operator console'),
    sprite('player_idle'));
  const card = element('section', { className: 'panel auth-card' },
    element('h2', { text: register ? 'Create an account' : 'Operator sign-in' }));
  const form = element('form', { className: 'stack' },
    inputField('Username', { name: 'username', autocomplete: 'username', minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_\\-]{3,20}', title: 'Use 3 to 20 letters, digits, underscores, or hyphens.' }),
    register && inputField('Email', { name: 'email', type: 'email', autocomplete: 'email', maxlength: 254 }),
    inputField('Password', {
      name: 'password',
      type: 'password',
      autocomplete: register ? 'new-password' : 'current-password',
      ...(register ? { minlength: 12, 'aria-describedby': 'password-hint' } : {})
    }),
    register && element('span', { className: 'hint', text: 'Use at least 12 characters.', attrs: { id: 'password-hint' } }),
    button(register ? 'Create account' : 'Sign in', null, 'primary', { type: 'submit' })
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
  const swap = button(register ? 'Sign in instead' : 'Create an account', () => {
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
    const status = cleared ? 'Cleared' : available ? 'Current sector · Fight ' + (campaign.fight + 1) + ' of 7' : 'Locked';
    const details = element('div', {},
      element('h2', { text: name }),
      element('span', { className: 'sector-status', text: status }));
    if (available) {
      details.append(element('div', { className: 'actions' },
        button(campaign.fight === 6 ? 'Challenge boss' : 'Start fight', () => startBattle('campaign'), 'primary'),
        campaign.fight === 6 && element('span', { className: 'boss-note', text: 'Boss encounter' })));
    }
    sector.append(details);
    track.append(sector);
  }
  const operator = element('section', { className: 'panel operator' },
    element('p', { className: 'terminal-label', text: state.session.user.username }),
    element('h2', { text: player.rank }),
    sprite(allCleared ? 'player_victory' : 'player_idle'),
    xpReadout(player),
    element('p', { className: 'measure', text: 'HP ' + player.hp + ' / ' + player.maxHp }));
  const endlessCard = element('section', { className: 'panel endless-card' },
    element('h2', { text: 'Endless arena' }),
    element('p', { className: 'lede', text: endless.unlocked
      ? 'Face random enemies. Every five kills raises the difficulty.'
      : 'Clear all seven sectors to unlock endless runs.' }),
    button(endless.unlocked ? 'Enter endless' : 'Endless locked', () => startBattle('endless'), 'primary',
      endless.unlocked ? {} : { disabled: '' }));
  return element('div', {},
    heading('Campaign map', allCleared ? 'All seven sectors cleared.' : 'Clear each sector to advance through the campaign.'),
    element('div', { className: 'map-layout' }, track, element('div', { className: 'stack' }, operator, endlessCard)));
}

function startBattle(mode) {
  perform(async () => {
    const battle = await api('/battles', { method: 'POST', body: { mode } });
    state.progress = battle.progress;
    state.battle = { ...battle, mode };
    state.result = null;
    show('battle');
  });
}

function submitAnswer(answer) {
  perform(async () => {
    const battle = state.battle;
    if (!battle?.question || state.result) return;
    const { id, question } = battle;
    try {
      const result = await api('/battles/' + encodeURIComponent(id) + '/answer', {
        method: 'POST',
        body: { questionId: question.id, ...answer }
      });
      state.progress = result.progress;
      state.battle = { ...battle, enemy: result.enemy, question: result.question };
      state.result = { ...result, unlockAt: performance.now() + (result.correct ? 0 : 3000) };
      show('battle');
      continueButton?.focus();
    } catch (error) {
      if (error.status !== 409 && error.status !== 404) throw error;
      await loadMap();
      notice.textContent = 'This fight changed in another request. The map shows your saved progress.';
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
  const battleLabel = mode === 'endless' ? 'Endless · ' + endless.kills + ' kills · Tier ' + endless.difficulty :
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
  if (question) {
    timerReadout = bar('question-time', result ? 'Next question' : 'Time remaining',
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
      button('Forfeit fight', forfeit, 'quiet danger')),
    !result && mode === 'campaign' &&
      element('p', { className: 'hint', text: 'Fight ' + (campaign.fight + 1) + ' of 7' }));
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
    container.append(choices, element('p', { className: 'hint', text: 'Use keys 1 to 4 or select an answer.' }));
  } else {
    const form = element('form', { className: 'stack' },
      inputField('Your answer', { name: 'text', maxlength: 250, autocomplete: 'off', spellcheck: 'false' }),
      element('div', { className: 'actions' }, button('Submit answer', null, 'primary', { type: 'submit' })));
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
  const title = result.timedOut ? 'Time expired' : result.correct ? 'Correct answer' : 'Incorrect answer';
  const damage = result.correct
    ? result.damageDealt + ' damage dealt.'
    : result.damageTaken + ' damage taken. Combo reset.';
  const feedback = element('div', {},
    element('div', { className: 'panel feedback ' + (result.correct ? '' : 'wrong'), attrs: { role: 'status' } },
      element('h2', { text: title }),
      element('p', { text: damage }),
      element('p', {}, 'Answer: ', element('strong', { text: result.correctAnswer })),
      element('p', { text: result.explanation })));
  if (result.status === 'won') {
    feedback.append(element('p', { text: 'Enemy defeated. +' + result.earnedXp + ' XP' }));
    if (result.rankUp) {
      feedback.append(element('p', { text: 'Rank up: ' + state.progress.player.rank }));
    }
    feedback.append(xpReadout(state.progress.player));
  }
  const label = result.status === 'lost' ? 'See run result' :
    result.status === 'won' ? (mode === 'endless' ? 'Next enemy' : 'Back to map') : 'Continue';
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
    state.result = null;
    show('battle');
    view.querySelector('#question-prompt')?.focus();
  }
}

function forfeit() {
  if (state.busy || !state.battle) return;
  if (!window.confirm('Forfeit this fight and restart your section or endless run?')) return;
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
      notice.textContent = 'This fight is no longer active. The map shows your saved progress.';
    }
  });
}

function renderDefeat({ mode, enemy, runSummary, forfeited }) {
  const endless = mode === 'endless';
  const title = endless ? 'Endless run complete' : forfeited ? 'Fight forfeited' : 'Operator down';
  const description = forfeited ? 'You left the fight against ' + enemy.name + '.' : enemy.name + ' defeated your operator.';
  return element('section', { className: 'panel defeat' },
    heading(title, description),
    sprite('player_hurt', 'aftermath'),
    element('p', { text: 'XP kept: ' + state.progress.player.xp }),
    endless && runSummary && statsList([
      ['Enemies defeated', runSummary.kills],
      ['Best streak this run', runSummary.bestStreak]
    ]),
    !endless && element('p', { className: 'muted', text: 'Your section restarts at fight 1 with full HP.' }),
    element('div', { className: 'actions' },
      button(endless ? 'Start another run' : 'Retry section', () => startBattle(mode), 'primary'),
      button('Back to map', () => perform(loadMap))));
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
    heading('Weak spots', 'Review the terms you miss most often.'),
    terms.length
      ? table(['Term', 'Sector', 'Correct', 'Wrong', 'Definition'], terms.slice(0, 15).map(term => [
        term.term, sections[term.section], term.correct, term.wrong, term.definition
      ]), 'Weak spots table')
      : element('p', { text: 'Missed terms will appear here after your battles.' }));
}

function renderLeaderboard({ entries }) {
  return element('section', {},
    heading('Endless leaderboard', 'Top operators ranked by their best endless runs.'),
    entries.length
      ? table(['Place', 'Operator', 'Rank', 'Best kills', 'Best streak'], entries.slice(0, 20).map((entry, index) => [
        index + 1,
        element('a', { text: entry.username, attrs: { href: '/?player=' + encodeURIComponent(entry.userId) } }),
        entry.rank, entry.bestKills, entry.bestStreak
      ]), 'Endless leaderboard table')
      : element('p', { text: 'No endless runs have been recorded yet.' }));
}

function statsList(stats) {
  return element('dl', { className: 'public-stats' }, ...stats.map(([label, value]) =>
    element('div', {}, element('dt', { text: label }), element('dd', { text: value }))));
}

function renderPublic({ username, rank, bestKills, sectionsCleared }) {
  return element('section', {},
    heading(username, null, 'Public operator record'),
    statsList([['Rank', rank], ['Best endless kills', bestKills], ['Sectors cleared', sectionsCleared + ' / 7']]),
    button('Back to leaderboard', () => perform(loadLeaderboard)));
}

function updateClocks() {
  if (timerReadout && state.battle?.question) {
    const { startedAt, timeLimitSeconds } = state.battle.question;
    const remaining = Math.min(timeLimitSeconds, Math.max(0, timeLimitSeconds - (Date.now() - startedAt) / 1000));
    const label = remaining > 0 ? Math.ceil(remaining) + 's' : '0s · expired';
    timerReadout.meter.value = remaining;
    timerReadout.meter.classList.toggle('warning', remaining <= 5);
    if (timerReadout.text.textContent !== label) timerReadout.text.textContent = label;
  }
  if (continueButton && state.result) {
    const delay = Math.max(0, Math.ceil((state.result.unlockAt - performance.now()) / 1000));
    const label = delay > 0 ? 'Available in ' + delay + 's' : 'Enter to continue';
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
    heading('Game unavailable', 'Check your connection or open the leaderboard.'),
    button('Try again', () => perform(retry), 'primary'),
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
