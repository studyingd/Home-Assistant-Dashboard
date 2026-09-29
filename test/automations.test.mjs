// server/automations.mjs 纯逻辑单测:HA 配置互转 + 通道展开(面板识别规则见 switch-panels.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATION_MARKER, parseHaAutomation, lightControlEntities, toHaAutomation } from '../server/automations.mjs';

const AVAILABLE = new Set([
  'light.xiaomi_w3_ed80_all_switch_indicator',
  'light.xiaomi_w2_4a4e_all_switch',
  'light.cuco_v3_3244_indicator_light',
  'switch.xiaomi_w3_ed80_left_switch_service',
  'switch.xiaomi_w3_ed80_middle_switch_service',
  'switch.xiaomi_w3_ed80_right_switch_service',
  'switch.xiaomi_w2_4a4e_left_switch_service',
  'switch.xiaomi_w2_4a4e_right_switch_service',
  'switch.cuco_v3_3244_switch',
  'climate.hall_ac',
]);

test('parseHaAutomation parses managed time automation and normalizes channels to panel mains', () => {
  const config = {
    id: 'abc123',
    alias: `${AUTOMATION_MARKER} 下班关灯`,
    triggers: [{ trigger: 'time', at: '18:30:00', weekday: ['mon', 'tue'] }],
    actions: [{ action: 'homeassistant.turn_off', target: { entity_id: ['switch.xiaomi_w3_ed80_left_switch_service'] } }],
  };
  const parsed = parseHaAutomation(config, { state: 'on' }, AVAILABLE);
  assert.deepEqual(parsed, {
    id: 'abc123',
    name: '下班关灯',
    entity_ids: ['light.xiaomi_w3_ed80_all_switch_indicator'],
    target_mode: 'devices',
    action: 'turn_off',
    time: '18:30',
    days: [1, 2],
    enabled: true,
  });
});

test('parseHaAutomation ignores non-managed or malformed automations', () => {
  assert.equal(parseHaAutomation({ alias: '别人的自动化', triggers: [], actions: [] }, { state: 'on' }, AVAILABLE), null);
  assert.equal(parseHaAutomation(null, { state: 'on' }, AVAILABLE), null);
  const badAction = {
    id: 'x',
    alias: `${AUTOMATION_MARKER} 坏结构`,
    triggers: [{ trigger: 'time', at: '08:00' }],
    actions: [{ action: 'light.toggle', target: { entity_id: ['light.hall'] } }],
  };
  assert.equal(parseHaAutomation(badAction, { state: 'on' }, AVAILABLE), null);
});

test('parseHaAutomation keeps domain-target automations untouched', () => {
  const config = {
    id: 'dom1',
    alias: `${AUTOMATION_MARKER} 全屋空调`,
    triggers: [{ trigger: 'time', at: '08:00' }],
    actions: [{ action: 'homeassistant.turn_on', target: { entity_id: ['states.climate|entities'] } }],
  };
  const parsed = parseHaAutomation(config, { state: 'off' }, AVAILABLE);
  assert.equal(parsed.target_mode, 'domain');
  assert.equal(parsed.target_domain, 'climate');
  assert.deepEqual(parsed.entity_ids, []);
  assert.equal(parsed.enabled, false);
});

test('lightControlEntities expands panel mains and falls back for plain lights', () => {
  // 新命名面板:整组主体 → 三分路
  assert.deepEqual(lightControlEntities('light.xiaomi_w3_ed80_all_switch_indicator', AVAILABLE), [
    'switch.xiaomi_w3_ed80_left_switch_service',
    'switch.xiaomi_w3_ed80_middle_switch_service',
    'switch.xiaomi_w3_ed80_right_switch_service',
  ]);
  // W2 双路 + 插座单路
  assert.deepEqual(lightControlEntities('light.xiaomi_w2_4a4e_all_switch', AVAILABLE), [
    'switch.xiaomi_w2_4a4e_left_switch_service',
    'switch.xiaomi_w2_4a4e_right_switch_service',
  ]);
  assert.deepEqual(lightControlEntities('light.cuco_v3_3244_indicator_light', AVAILABLE), ['switch.cuco_v3_3244_switch']);
  // 非面板灯光(空调不是 light,用不存在的实体)→ 原样保留
  assert.deepEqual(lightControlEntities('light.hall_plain', AVAILABLE), ['light.hall_plain']);
});

test('toHaAutomation expands light targets to channels and throws without targets', () => {
  const automation = {
    id: 'new1',
    name: '午间关灯',
    target_mode: 'domain',
    target_domain: 'light',
    action: 'turn_off',
    time: '12:30',
    days: [1, 2, 3, 4, 5],
    enabled: true,
  };
  const config = toHaAutomation(automation, AVAILABLE, AVAILABLE);
  assert.equal(config.alias, `${AUTOMATION_MARKER} 午间关灯`);
  assert.deepEqual(config.actions[0].target.entity_id, [
    'switch.xiaomi_w3_ed80_left_switch_service',
    'switch.xiaomi_w3_ed80_middle_switch_service',
    'switch.xiaomi_w3_ed80_right_switch_service',
    'switch.xiaomi_w2_4a4e_left_switch_service',
    'switch.xiaomi_w2_4a4e_right_switch_service',
    'switch.cuco_v3_3244_switch',
  ]);
  assert.equal(config.initial_state, true);
  assert.throws(() => toHaAutomation({ ...automation, entity_ids: [] }, new Set(), new Set()), /没有可用于自动化的/);
});
