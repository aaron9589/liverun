const { test } = require('node:test');
const assert = require('node:assert');
const { validateLayout } = require('../layout');

const boardingOk = (b) => assert.ok(validateLayout({ boarding: b }).layout, JSON.stringify(b));
const boardingBad = (b) => assert.ok(validateLayout({ boarding: b }).error, JSON.stringify(b));

test('accepts valid and partial boarding config', () => {
  boardingOk({});
  boardingOk({ max_passengers: 0, spread: 2, tick_s: 0.1, jitter: 1, flow_rate: 100, runner_chance: 1 });
  boardingOk({ demand_curve: [['00:00', 0.5], ['24:00', 0]], runner_count: [2, 2], runner_delay_s: [0, 60], show_alighting: true });
  boardingOk({
    rules: [{ name: '', when: { direction: 'Down*', train_id: '9*', train_name: 'x', from: '22:00', to: '04:30' }, factor: 0 }],
    position: { origin: 1.2, intermediate: 1, terminus: 0 },
    alighting: { max_passengers: 40, demand_curve: [['08:00', 1]], rules: [], position: { terminus: 2 } },
  });
});

test('rejects bad boarding values', () => {
  boardingBad('x');
  boardingBad({ max_passengers: 1001 });
  boardingBad({ max_passengers: -1 });
  boardingBad({ max_passengers: '5' });
  boardingBad({ spread: 2.1 });
  boardingBad({ tick_s: 0 });
  boardingBad({ tick_s: 11 });
  boardingBad({ jitter: 1.5 });
  boardingBad({ flow_rate: 0 });
  boardingBad({ straggler_threshold: 101 });
  boardingBad({ straggler_rate: 0 });
  boardingBad({ runner_chance: 2 });
  boardingBad({ runner_count: [3, 1] });
  boardingBad({ runner_count: [1] });
  boardingBad({ runner_delay_s: [1, 61] });
  boardingBad({ start_delay_s: 61 });
  boardingBad({ doil_off_delay_s: -1 });
  boardingBad({ show_alighting: 'yes' });
  boardingBad({ demand_curve: [] });
  boardingBad({ demand_curve: [['25:00', 1]] });
  boardingBad({ demand_curve: [['24:30', 1]] });
  boardingBad({ demand_curve: [['8am', 1]] });
  boardingBad({ demand_curve: [['08:00', -1]] });
  boardingBad({ demand_curve: [['08:00']] });
  boardingBad({ rules: [{ name: 5, when: {}, factor: 1 }] });
  boardingBad({ rules: [{ name: 'a', when: { colour: 'red' }, factor: 1 }] });
  boardingBad({ rules: [{ name: 'a', when: { direction: 1 }, factor: 1 }] });
  boardingBad({ rules: [{ name: 'a', when: { from: '99:00' }, factor: 1 }] });
  boardingBad({ rules: [{ name: 'a', when: {}, factor: -0.1 }] });
  boardingBad({ position: { terminus: -1 } });
  boardingBad({ alighting: { max_passengers: 5000 } });
  boardingBad({ alighting: { demand_curve: [] } });
});

test('validates stats config', () => {
  const ok = (s) => assert.ok(validateLayout({ stats: s }).layout, JSON.stringify(s));
  const bad = (s) => assert.ok(validateLayout({ stats: s }).error, JSON.stringify(s));
  ok({});
  ok({ enabled: false, topic: '', payload: 'count', publish_on: 'door_close' });
  ok({ enabled: true, topic: 'trains/stats/{train}/{trainId}/{station}', payload: 'json', publish_on: 'boarding_start' });
  bad('x');
  bad({ enabled: 1 });
  bad({ enabled: true, topic: '' });
  bad({ enabled: true, topic: '   ' });
  bad({ topic: 'a/+/b' });
  bad({ topic: 'a/#' });
  bad({ topic: 'a/{nope}' });
  bad({ topic: 'a/{train' });
  bad({ topic: 'x'.repeat(201) });
  bad({ topic: 5 });
  bad({ payload: 'xml' });
  bad({ publish_on: 'never' });
});
