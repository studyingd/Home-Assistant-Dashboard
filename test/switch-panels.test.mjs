/**
 * 开关面板识别规则的单元测试(共享模块 shared/switch-panels.mjs)。
 * 修改命名规则时先更新此处,保证前后端行为一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelKeyFromText,
  hasPanelChannels,
  isLightPanelMain,
  lightMainEntityCandidates,
  lightMainStem,
  panelChannelIds,
  panelChannelStem,
  panelControlEntityIds,
  isLightPanelSwitch,
} from '../shared/switch-panels.mjs';

test('lightMainStem 识别新旧整组主体与键指示灯', () => {
  assert.equal(lightMainStem('light.xiaomi_w2_4a4e_all_switch'), 'xiaomi_w2_4a4e');
  assert.equal(lightMainStem('light.xiaomi_w3_ed80_all_switch_indicator'), 'xiaomi_w3_ed80');
  assert.equal(lightMainStem('light.xiaomi_w3_ed80_indicator_light'), 'xiaomi_w3_ed80');
  assert.equal(lightMainStem('light.xiaomi_w3_ed80_indicator_light_2'), 'xiaomi_w3_ed80');
  assert.equal(lightMainStem('light.xiaomi_w2_4a4e_left_switch'), 'xiaomi_w2_4a4e');
  assert.equal(lightMainStem('light.xiaomi_w3_ed80_left_switch_indicator'), 'xiaomi_w3_ed80');
  assert.equal(lightMainStem('switch.xiaomi_w2_4a4e_switch'), null);
  assert.equal(lightMainStem('light.liyan_liyan_1816_light'), null);
});

test('panelChannelIds / panelControlEntityIds 覆盖全部分路和单路', () => {
  assert.deepEqual(panelChannelIds('s1'), ['switch.s1_left_switch_service', 'switch.s1_middle_switch_service', 'switch.s1_right_switch_service']);
  assert.deepEqual(panelControlEntityIds('s1'), [
    'switch.s1_switch',
    'switch.s1_left_switch_service',
    'switch.s1_middle_switch_service',
    'switch.s1_right_switch_service',
  ]);
});

test('panelChannelStem 只匹配分路通道服务', () => {
  assert.equal(panelChannelStem('switch.xiaomi_w2_4a4e_left_switch_service'), 'xiaomi_w2_4a4e');
  assert.equal(panelChannelStem('switch.xiaomi_w2_4a4e_switch'), null);
});

test('hasPanelChannels / isLightPanelMain 需要设备真实存在通道', () => {
  const ids = ['light.a_all_switch', 'switch.a_left_switch_service', 'switch.a_right_switch_service', 'light.b_indicator_light'];
  assert.equal(hasPanelChannels('a', ids), true);
  assert.equal(hasPanelChannels('b', ids), false);
  assert.equal(isLightPanelMain('light.a_all_switch', ids), true);
  // _indicator_light 形态只有在通道存在时才算面板主体(排除插座/网关指示灯)
  assert.equal(isLightPanelMain('light.b_indicator_light', ids), false);
  assert.equal(isLightPanelMain('light.c_all_switch', ids), false);
});

test('lightMainEntityCandidates 按新旧命名排序', () => {
  assert.deepEqual(lightMainEntityCandidates('x'), [
    'light.x_all_switch',
    'light.x_all_switch_indicator',
    'light.x_indicator_light',
  ]);
});

test('channelKeyFromText 识别数字与左右中键', () => {
  assert.deepEqual(channelKeyFromText('10A 前台2 开关左键 switch.x_left_switch_service'), { kind: 'left' });
  assert.deepEqual(channelKeyFromText('TrainingRoomLight 开关 2 switch.x_switch_2'), { kind: 'number', value: 2 });
  assert.deepEqual(channelKeyFromText('前台 开关右键'), { kind: 'right' });
  assert.deepEqual(channelKeyFromText('前台 开关中键'), { kind: 'middle' });
  assert.equal(channelKeyFromText('客厅主灯 light.main'), null);
});

test('isLightPanelSwitch: 单键灯光面板成立,插座/分路通道/灯光域实体不成立', () => {
  // W1 单键面板:HA 中存在整组灯主体 → 是灯光面板开关
  const available = new Set(['light.xiaomi_w1_07ef_all_switch']);
  assert.equal(isLightPanelSwitch('switch.xiaomi_w1_07ef_switch', available), true);
  // 实体数据未就绪(null)时仅按形态判断
  assert.equal(isLightPanelSwitch('switch.xiaomi_w1_07ef_switch', null), true);
  // cuco 插座形态相似但没有整组灯主体 → 排除
  assert.equal(isLightPanelSwitch('switch.cuco_v3_3244_switch', new Set(['light.cuco_v3_3244_indicator_light'])), false);
  // W2 分路通道是 _switch_service 后缀,不属于单键形态
  assert.equal(isLightPanelSwitch('switch.xiaomi_w2_4a4e_left_switch_service', available), false);
  // 灯光域实体不属于开关域判断范围
  assert.equal(isLightPanelSwitch('light.xiaomi_w2_4a4e_all_switch', available), false);
});