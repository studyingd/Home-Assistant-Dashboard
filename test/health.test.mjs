// server/health.mjs 单测:健康核对逻辑 + 定时缓存行为(依赖注入,不起真实服务)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthService } from '../server/health.mjs';

const CONFIG = {
  regions: [
    {
      id: 'r1',
      name: '办公区',
      blocks: [
        { id: 'b1', name: '前台', devices: [
          { entity_id: 'light.a', type: 'light' },
          { entity_id: 'light.gone', type: 'light', name: '失效灯' },
          { entity_id: 'climate.b', type: 'climate' },
        ] },
        { id: 'b2', name: '工位', devices: [
          { entity_id: 'cover.c', type: 'cover' },
          { entity_id: 'sensor.off', type: 'sensor' },
        ] },
      ],
    },
  ],
};

test('buildDeviceHealth flags missing first with ids/location, unavailable second', async () => {
  const states = [
    { entity_id: 'light.a', state: 'on', attributes: { friendly_name: '灯A' } },
    { entity_id: 'climate.b', state: 'cool', attributes: { friendly_name: '空调B' } },
    { entity_id: 'cover.c', state: 'closed', attributes: { friendly_name: '窗帘C' } },
    { entity_id: 'sensor.off', state: 'unavailable', attributes: { friendly_name: '传感器' } },
  ];
  const service = createHealthService({ readConfig: async () => CONFIG }, async () => states);
  const report = await service.buildDeviceHealth();
  assert.equal(report.total, 5);
  assert.equal(report.problems.length, 2);
  // missing 优先排序
  assert.equal(report.problems[0].status, 'missing');
  assert.equal(report.problems[0].entity_id, 'light.gone');
  assert.equal(report.problems[0].regionId, 'r1');
  assert.equal(report.problems[0].blockId, 'b1');
  assert.equal(report.problems[0].name, '失效灯');
  assert.equal(report.problems[0].location, '办公区 / 前台');
  assert.equal(report.problems[1].status, 'unavailable');
  assert.equal(report.problems[1].entity_id, 'sensor.off');
  assert.equal(report.problems[1].state, 'unavailable');
});

test('ensureDeviceHealth serves cached report and refreshes only when stale', async () => {
  let calls = 0;
  const service = createHealthService(
    { readConfig: async () => ({ regions: [] }) },
    async () => { calls += 1; return []; },
  );
  assert.equal(service.getReport(), null);
  await service.ensureDeviceHealth(30 * 60_000);
  assert.equal(calls, 1);
  assert.equal(service.getReport().total, 0);
  await service.ensureDeviceHealth(30 * 60_000);
  assert.equal(calls, 1, '缓存新鲜时不应重新请求 HA');
  await service.ensureDeviceHealth(0);
  assert.equal(calls, 2, 'maxAge=0 应强制刷新');
});

test('HA unreachable keeps previous report instead of failing', async () => {
  let healthy = true;
  const service = createHealthService(
    { readConfig: async () => ({ regions: [] }) },
    async () => { if (!healthy) throw new Error('HA down'); return []; },
  );
  await service.ensureDeviceHealth(0);
  const first = service.getReport();
  assert.ok(first && typeof first.checkedAt === 'string');
  healthy = false;
  await service.ensureDeviceHealth(0);
  assert.equal(service.getReport(), first, '刷新失败应保留旧报告');
});
