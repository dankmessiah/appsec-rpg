'use strict';
const test = global.test || require('node:test');
const assert = require('node:assert/strict');
const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test('the full glossary spans seven sections and 25 reciprocal drill groups', () => {
  const terms = require('../../db/terms.json');
  const groups = require('../../db/drill-groups.json');
  const { generateQuestion, checkAnswer } = require('../../shared/questions');
  const byId = new Map(terms.map(term => [term.id, term]));
  const byGroup = new Map(groups.map(group => [group.id, group]));
  assert.equal(groups.length, 25);
  assert.equal(byGroup.size, groups.length);
  assert.equal(byId.size, terms.length);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, section) => terms.filter(term => term.section === section).length),
    [32, 29, 24, 19, 18, 22, 29],
  );
  assert.equal(terms.length, 173);
  assert.equal(terms.filter(term => term.drill_group_ids.length > 0).length, 44);
  for (let section = 0; section < 7; section += 1) {
    for (const roll of [0, 0.99]) {
      const question = generateQuestion({ terms, section, boss: true, mode: 'campaign', rng: () => roll, now: 0 });
      const term = byId.get(question.termId);
      assert.equal(term.section, section);
      assert.ok(term.drill_group_ids.length > 0);
      const input = question.variant === 'recall' ? { text: term.term } : { choice: question.answer };
      assert.equal(checkAnswer(question, input, 0).correct, true);
    }
  }
  for (const group of groups) {
    assert.match(group.id, keyPattern);
    assert.ok(group.label && group.term_ids.length);
    assert.equal(new Set(group.term_ids).size, group.term_ids.length);
    for (const id of group.term_ids) assert.ok(byId.get(id)?.drill_group_ids.includes(group.id), id);
  }
  for (const term of terms) {
    assert.match(term.id, keyPattern);
    assert.ok(term.term && term.definition);
    assert.ok(term.aliases.every(alias => typeof alias === 'string' && alias.length > 0));
    assert.equal(new Set(term.drill_group_ids).size, term.drill_group_ids.length);
    for (const id of term.drill_group_ids) assert.ok(byGroup.get(id)?.term_ids.includes(term.id), id);
  }
  assert.deepEqual(byGroup.get('cvss-epss-kev').term_ids, ['cvss', 'epss', 'cisa-kev']);
  assert.deepEqual(byGroup.get('asvs-samm-ssdf').term_ids, ['owasp-asvs-5-0', 'owasp-samm-v2', 'nist-ssdf']);
});


test('every sector-zero answer has distinct teaching feedback and a concrete example', () => {
  const terms = require('../../db/terms.json');
  const { generateQuestion } = require('../../shared/questions');
  for (const term of terms.filter(item => item.section === 0)) {
    assert.ok(term.explanation && term.explanation.includes('Example:'), term.id);
    assert.notEqual(term.explanation, term.definition);
    const question = generateQuestion({ terms: [term, ...terms.filter(item => item.section !== 0)], section: 0, mode: 'campaign', now: 0, rng: () => .6 });
    assert.equal(question.explanation, term.explanation);
  }
});
