// 设备健康检查:核对看板配置的设备实体在 HA 中的存在性/可用性。
// buildDeviceHealth 每次实时全量核对;定时缓存供管理页角标等低频查询复用,避免每次都实时全量核对。
export function createHealthService(configStore, haRest) {
  async function buildDeviceHealth() {
    const [config, states] = await Promise.all([configStore.readConfig(), haRest('/api/states')]);
    const stateById = new Map(states.map((state) => [state.entity_id, state]));
    const problems = [];
    let total = 0;
    for (const region of Array.isArray(config?.regions) ? config.regions : []) {
      for (const block of Array.isArray(region?.blocks) ? region.blocks : []) {
        for (const device of Array.isArray(block?.devices) ? block.devices : []) {
          if (typeof device?.entity_id !== 'string') continue;
          total += 1;
          const state = stateById.get(device.entity_id);
          const location = [region?.name, block?.name].filter(Boolean).join(' / ');
          const name = device.name || state?.attributes?.friendly_name || device.entity_id;
          if (!state) {
            problems.push({ entity_id: device.entity_id, regionId: region.id, blockId: block.id, name, location, status: 'missing', state: '' });
          } else if (state.state === 'unavailable' || state.state === 'unknown') {
            problems.push({ entity_id: device.entity_id, regionId: region.id, blockId: block.id, name, location, status: 'unavailable', state: state.state });
          }
        }
      }
    }
    problems.sort((a, b) => (a.status === b.status ? a.entity_id.localeCompare(b.entity_id) : a.status === 'missing' ? -1 : 1));
    return { checkedAt: new Date().toISOString(), total, problems };
  }

  const healthCache = { report: null, refreshing: null };
  function refreshDeviceHealth() {
    return buildDeviceHealth()
      .then((report) => { healthCache.report = report; })
      .catch(() => { /* HA 不可达时保留旧报告,等下次定时再试 */ })
      .finally(() => { healthCache.refreshing = null; });
  }
  /** 报告缺失或超过 maxAgeMs 时后台补跑;返回进行中的刷新任务(便于首次查询等待结果) */
  function ensureDeviceHealth(maxAgeMs = 30 * 60_000) {
    const report = healthCache.report;
    if (report && Date.now() - Date.parse(report.checkedAt) < maxAgeMs) return Promise.resolve();
    if (!healthCache.refreshing) healthCache.refreshing = refreshDeviceHealth();
    return healthCache.refreshing;
  }
  function getReport() {
    return healthCache.report;
  }

  return { buildDeviceHealth, ensureDeviceHealth, getReport };
}
