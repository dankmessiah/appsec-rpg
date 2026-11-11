'use strict';

const { randomUUID } = require('node:crypto');

function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickTerm(pool, stats, weighted, rng) {
  if (pool.length === 0) throw new RangeError('No terms are available for this question');
  const weights = pool.map(({ id }) => {
    const record = stats[id];
    return weighted ? 1 + 2 * Math.max(0, (record?.wrong ?? 0) - (record?.correct ?? 0)) : 1;
  });
  let cursor = rng() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) {
    cursor -= weight;
    if (cursor < 0) return pool[index];
  }
  return pool.at(-1);
}

function makeOptions(terms, term, field, rng) {
  const correct = term[field];
  const seen = new Set([correct]);
  const options = [correct];
  const collect = (candidates) => {
    for (const item of shuffle(candidates, rng)) {
      const label = item[field];
      if (options.length === 4) break;
      if (item.id !== term.id && !seen.has(label)) {
        seen.add(label);
        options.push(label);
      }
    }
  };

  collect(terms.filter((item) => item.section === term.section));
  if (options.length < 4) collect(terms.filter((item) => item.section !== term.section));
  if (options.length < 4) throw new RangeError('Four distinct answer options are required');
  const shuffled = shuffle(options, rng);
  return { options: shuffled, answer: shuffled.indexOf(correct) };
}

function generateQuestion({
  terms, section, boss = false, mode, stats = {}, difficulty = 0, now = Date.now(), rng = Math.random,
}) {
  const endless = mode === 'endless';
  const sectionTerms = terms.filter((item) => item.section === section);
  const pool = boss ? sectionTerms.filter((item) => item.drill_group_ids?.length > 0) : sectionTerms;
  const term = pickTerm(pool, stats, boss || endless, rng);
  const mcVariants = term.scenario ? ['definition', 'reverse', 'scenario'] : ['definition', 'reverse'];
  const roll = rng();
  const recall = (boss || endless) && roll < 0.5;
  const mcRoll = boss || endless ? (roll - 0.5) * 2 : roll;
  const variant = recall ? 'recall' : mcVariants[Math.floor(mcRoll * mcVariants.length)];
  const timeLimitSeconds = Math.max(recall ? 12 : 8, (recall ? 30 : 20) - (endless ? 2 * difficulty : 0));
  const prompts = {
    recall: () => 'Name the term: ' + term.definition,
    definition: () => 'Which term means: ' + term.definition.replace(/[.!?]+$/, '') + '?',
    reverse: () => 'What is ' + term.term + '?',
    scenario: () => term.scenario + ' Which term applies?',
  };
  return {
    id: randomUUID(),
    variant,
    prompt: prompts[variant](),
    timeLimitSeconds,
    startedAt: now,
    termId: term.id,
    aliases: [...(term.aliases ?? [])],
    explanation: term.explanation || term.definition,
    ...(recall ? { answer: term.term } : makeOptions(terms, term, variant === 'reverse' ? 'definition' : 'term', rng)),
  };
}

function publicQuestion(question) {
  const { id, variant, prompt, options, timeLimitSeconds, startedAt } = question;
  return { id, variant, prompt, ...(options ? { options: [...options] } : {}), timeLimitSeconds, startedAt };
}

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function oneEditApart(actual, expected) {
  if (Math.abs(actual.length - expected.length) > 1) return false;
  const [shorter, longer] = actual.length <= expected.length ? [actual, expected] : [expected, actual];
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i += 1;
  return shorter.slice(i + Number(shorter.length === longer.length)) === longer.slice(i + 1);
}

function checkAnswer(question, { choice, text }, now = Date.now()) {
  const elapsedMs = Math.max(0, now - question.startedAt);
  const timedOut = elapsedMs > (question.timeLimitSeconds + 2) * 1000;
  const recall = question.variant === 'recall';
  const correctAnswer = recall ? question.answer : question.options[question.answer];
  let correct = false;
  if (!timedOut && recall && typeof text === 'string') {
    const actual = normalize(text);
    correct = Boolean(actual) && [question.answer, ...(question.aliases ?? [])].some((value) => {
      const expected = normalize(value);
      return actual === expected || (expected.length > 5 && oneEditApart(actual, expected));
    });
  } else if (!timedOut && !recall) {
    correct = Number.isInteger(choice) && choice >= 0 && choice < question.options.length && choice === question.answer;
  }
  return { correct, timedOut, elapsedMs, correctAnswer, explanation: question.explanation };
}

module.exports = { generateQuestion, publicQuestion, checkAnswer };
