'use strict';
const test = global.test || require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/lab/n8n/appsec-ingest.json'), 'utf8'));
const node = name => workflow.nodes.find(n => n.name === name);
const execute = (name, items) => new Function('$input', node(name).parameters.jsCode)({ all: () => items });
const descriptor = (id = 'js/sql-injection', score = '8.8') => ({ id, shortDescription: { text: 'SQL injection' }, properties: { 'security-severity': score, precision: 'high' } });
const result = () => ({ ruleId: 'js/sql-injection', rule: { id: 'js/sql-injection', index: 0, toolComponent: { index: 1 } }, locations: [{ physicalLocation: { artifactLocation: { uri: 'server/example.js' }, region: { startLine: 36 } } }] });
const report = () => ({ runs: [{ tool: { driver: { name: 'CodeQL', rules: [] }, extensions: [{ name: 'metadata' }, { name: 'queries', guid: 'query-guid', rules: [descriptor()] }] }, results: [result()] }] });
const normalize = sarif => execute('Normalize Findings', [{ json: { source: { repo: 'example/app' }, sarif } }]);
const enrich = items => execute('Enrich Owner Tier Exposure', items);

test('extension descriptor preserves CodeQL score, confidence, title and SLA', () => {
  const [item] = enrich(normalize(report()));
  assert.equal(item.json.severity, 'high');
  assert.equal(item.json.confidence, 'high');
  assert.equal(item.json.title, 'SQL injection');
  assert.equal(item.json.slaDays, 30);
  assert.equal(item.json.line, 36);
});

test('driver descriptors, explicit driver index, zero score, result level and unknown rules work', () => {
  const sarif = report(); const run = sarif.runs[0];
  run.tool.driver.rules = [descriptor()]; run.tool.extensions = [];
  delete run.results[0].rule;
  assert.equal(normalize(sarif)[0].json.severity, 'high');
  run.results[0].ruleIndex = 0;
  assert.equal(normalize(sarif)[0].json.confidence, 'high');
  run.tool.driver.rules[0].properties['security-severity'] = '0';
  assert.equal(normalize(sarif)[0].json.severity, 'low');
  delete run.results[0].ruleIndex; run.results[0].ruleId = 'unknown'; run.results[0].level = 'error';
  assert.equal(normalize(sarif)[0].json.severity, 'high');
  delete run.results[0].level;
  assert.equal(normalize(sarif)[0].json.severity, 'medium');
});

test('component-scoped id fallback and result.rule.id cannot select unrelated same-id driver rule', () => {
  const sarif = report(); const run = sarif.runs[0];
  run.tool.driver.rules = [descriptor('js/sql-injection', '1')];
  delete run.results[0].rule.index; delete run.results[0].ruleId;
  assert.equal(normalize(sarif)[0].json.severity, 'high');
  assert.equal(normalize(sarif)[0].json.rule, 'js/sql-injection');
  run.results[0].rule.toolComponent = { name: 'queries', guid: 'query-guid' };
  assert.equal(normalize(sarif)[0].json.confidence, 'high');
});

for (const [name, mutate] of [
  ['missing component', r => { r.results[0].rule.toolComponent.index = 8; }],
  ['negative component index', r => { r.results[0].rule.toolComponent.index = -1; }],
  ['fractional descriptor index', r => { r.results[0].rule.index = 0.5; }],
  ['out of range descriptor', r => { r.results[0].rule.index = 8; }],
  ['descriptor id mismatch', r => { r.tool.extensions[1].rules[0].id = 'other'; }],
  ['conflicting result ids', r => { r.results[0].rule.id = 'other'; }],
  ['conflicting result indices', r => { r.results[0].ruleIndex = 1; }],
  ['component identity mismatch', r => { r.results[0].rule.toolComponent.name = 'other'; }],
  ['ambiguous component name', r => { r.tool.extensions[0].name = 'queries'; r.results[0].rule.toolComponent = { name: 'queries' }; }],
  ['ambiguous component rule id', r => { delete r.results[0].rule.index; r.tool.extensions[1].rules.push(descriptor()); }],
  ['unresolved explicit id', r => { delete r.results[0].rule.index; r.tool.extensions[1].rules = []; }],
]) test('rejects ' + name + ' instead of downgrading severity', () => {
  const sarif = report(); mutate(sarif.runs[0]);
  assert.throws(() => normalize(sarif), /SARIF descriptor/);
});

test('clean reports, secret tags and ZAP behavior remain intact', () => {
  const clean = report(); clean.runs[0].results = [];
  assert.deepEqual(normalize(clean), []);
  const secret = report(); secret.runs[0].tool.extensions[1].rules[0].properties.tags = ['secret'];
  assert.equal(normalize(secret)[0].json.kind, 'secret');
  assert.equal(normalize(secret)[0].json.severity, 'critical');
  const zap = execute('Normalize Findings', [{ json: { zap: { site: [{ '@name': 'https://example.invalid', alerts: [{ pluginid: '1', name: 'Example', riskcode: '2', confidence: '3', instances: [{ uri: 'https://example.invalid/a', method: 'GET' }] }] }] } } }]);
  assert.equal(zap[0].json.kind, 'dast'); assert.equal(zap[0].json.severity, 'medium'); assert.equal(zap[0].json.confidence, 'high');
});

test('native current-input dedupe precedes unchanged historical dedupe and preserves fields', () => {
  const next = name => workflow.connections[name].main[0][0].node;
  const current = node(next('Enrich Owner Tier Exposure'));
  assert.equal(current.type, 'n8n-nodes-base.removeDuplicates');
  assert.equal(current.typeVersion, 2);
  assert.deepEqual(current.parameters, { operation: 'removeDuplicateInputItems', compare: 'selectedFields', fieldsToCompare: 'dedupeKey', options: { removeOtherFields: false } });
  assert.equal(next(current.name), 'Drop Already-Ticketed Findings');
  assert.deepEqual(node('Drop Already-Ticketed Findings').parameters, { operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsWithAlreadySeenKeyValues', dedupeValue: '={{ $json.dedupeKey }}', options: { scope: 'node', historySize: 10000 } });
  const sarif = report(); sarif.runs[0].results.push(result());
  const items = enrich(normalize(sarif));
  assert.equal(items.length, 2); assert.equal(items[0].json.dedupeKey, items[1].json.dedupeKey);
  // Model the documented native current-input semantics, not an n8n runtime execution.
  const other = structuredClone(items[0]); other.json.dedupeKey += '|distinct'; items.push(other);
  const seen = new Set(); const kept = items.filter(i => !seen.has(i.json.dedupeKey) && seen.add(i.json.dedupeKey));
  assert.equal(kept.length, 2); assert.strictEqual(kept[0], items[0]); assert.deepEqual(kept[0].json, items[0].json);
  const history = new Set();
  const processHistory = batch => batch.filter(item => !history.has(item.json.dedupeKey) && history.add(item.json.dedupeKey));
  assert.equal(processHistory(kept).length, 2);
  assert.equal(processHistory(kept).length, 0);
  for (const [name, connections] of Object.entries(workflow.connections)) {
    assert.ok(node(name));
    for (const group of Object.values(connections)) for (const output of group) for (const edge of output) assert.ok(node(edge.node), edge.node);
  }
});
