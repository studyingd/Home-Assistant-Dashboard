import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAutomation, validateDashboard } from '../server/validation.mjs';

const allowed = new Set(['climate.office', 'light.office']);

test('validateDashboard accepts the persisted schema and rejects duplicate ids', () => {
  const config = {
    schemaVersion: 2,
    title: '看板',
    regions: [{ id: 'r1', name: '区域', blocks: [{ id: 'b1', name: '设备', devices: [{ entity_id: 'climate.office', type: 'climate' }] }] }],
  };
  assert.equal(validateDashboard(config), true);
  assert.equal(validateDashboard({ ...config, regions: [{ ...config.regions[0], blocks: [{ ...config.regions[0].blocks[0], id: 'r1' }] }] }), false);
});

test('validateAutomation only permits supported device domains', () => {
  const base = { id: 'a1', name: '规则', entity_ids: ['climate.office'], target_mode: 'devices', action: 'turn_off', time: '20:00', days: [1, 2, 3], enabled: true };
  assert.equal(validateAutomation(base, allowed), true);
  assert.equal(validateAutomation({ ...base, entity_ids: ['fan.office'] }, new Set(['fan.office'])), false);
  assert.equal(validateAutomation({ ...base, target_mode: 'domain', target_domain: 'input_boolean', entity_ids: [] }, allowed), false);
  assert.equal(validateAutomation({ ...base, target_mode: 'domain', target_domain: 'light', entity_ids: [] }, allowed), true);
  assert.equal(validateAutomation({ ...base, entity_ids: Array.from({ length: 73 }, (_, i) => `climate.office_${i}`) }, new Set(Array.from({ length: 73 }, (_, i) => `climate.office_${i}`))), true);
});
