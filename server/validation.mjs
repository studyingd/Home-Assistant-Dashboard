function validateString(value, max, required = true) {
  return typeof value === 'string' && value.trim().length <= max && (!required || value.trim().length > 0);
}

const MAX_AUTOMATION_ENTITIES = 2_000;

export function validateDashboard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schemaVersion !== 2 || !validateString(value.title, 100) || !Array.isArray(value.regions)) return false;
  if (value.regions.length > 50) return false;
  let blocks = 0;
  let devices = 0;
  const ids = new Set();
  for (const region of value.regions) {
    if (!region || typeof region !== 'object' || !validateString(region.id, 100) || !validateString(region.name, 100)) return false;
    if (ids.has(region.id) || !Array.isArray(region.blocks)) return false;
    ids.add(region.id);
    if (region.icon !== undefined && !validateString(region.icon, 50)) return false;
    if (region.hiddenFromUsers !== undefined && typeof region.hiddenFromUsers !== 'boolean') return false;
    const regionDeviceIds = new Set();
    blocks += region.blocks.length;
    if (blocks > 250) return false;
    for (const block of region.blocks) {
      if (!block || typeof block !== 'object' || !validateString(block.id, 100) || !validateString(block.name, 100)) return false;
      if (ids.has(block.id) || !Array.isArray(block.devices)) return false;
      ids.add(block.id);
      if (block.icon !== undefined && !validateString(block.icon, 50)) return false;
      if (block.hiddenFromUsers !== undefined && typeof block.hiddenFromUsers !== 'boolean') return false;
      devices += block.devices.length;
      if (devices > 2_000) return false;
      const entityIds = new Set();
      for (const device of block.devices) {
        if (!device || typeof device !== 'object') return false;
        if (typeof device.entity_id !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(device.entity_id)) return false;
        if (!['climate', 'sensor', 'cover', 'light', 'switch', 'generic'].includes(device.type)) return false;
        if (entityIds.has(device.entity_id)) return false;
        entityIds.add(device.entity_id);
        if (regionDeviceIds.has(device.entity_id)) return false;
        regionDeviceIds.add(device.entity_id);
        if (device.name !== undefined && !validateString(device.name, 100)) return false;
        if (device.icon !== undefined && !validateString(device.icon, 50)) return false;
        if (device.coverVariant !== undefined && !['window', 'curtain'].includes(device.coverVariant)) return false;
        if (device.hiddenFromUsers !== undefined && typeof device.hiddenFromUsers !== 'boolean') return false;
      }
    }
  }
  return true;
}

export function validateAutomation(value, allowedEntities) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!validateString(value.id, 100) || !validateString(value.name, 100)) return false;
  const targetMode = value.target_mode || 'devices';
  if (!['devices', 'domain'].includes(targetMode)) return false;
  if (targetMode === 'domain') {
    if (!['climate', 'light'].includes(value.target_domain)) return false;
  } else {
    if (!Array.isArray(value.entity_ids) || value.entity_ids.length === 0 || value.entity_ids.length > MAX_AUTOMATION_ENTITIES) return false;
    if (value.entity_ids.some((entityId) => !validateString(entityId, 255) || !allowedEntities.has(entityId))) return false;
    if (value.entity_ids.some((entityId) => !['climate', 'switch', 'light'].includes(entityId.split('.')[0]))) return false;
  }
  if (!['turn_on', 'turn_off'].includes(value.action)) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return false;
  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > 7) return false;
  if (value.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return false;
  if (new Set(value.days).size !== value.days.length) return false;
  return typeof value.enabled === 'boolean';
}
