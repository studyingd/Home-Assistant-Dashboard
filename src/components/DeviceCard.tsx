import type { DeviceConfig } from '../lib/types';
import { useEntityState } from '../ha/useEntityState';
import { NotFoundCard } from './ui/CardShell';
import { ClimateCard } from './cards/ClimateCard';
import { SensorCard } from './cards/SensorCard';
import { CoverCard } from './cards/CoverCard';
import { GenericCard } from './cards/GenericCard';
import { LightCard } from './cards/LightCard';
import { SwitchCard } from './cards/SwitchCard';

interface DeviceCardProps {
  config: DeviceConfig;
}

/** 按配置类型分发到对应卡片;实体不存在时显示占位卡 */
export function DeviceCard({ config }: DeviceCardProps) {
  const entity = useEntityState(config.entity_id);

  if (!entity) {
    return <NotFoundCard entityId={config.entity_id} />;
  }

  switch (config.type) {
    case 'climate':
      return <ClimateCard config={config} entity={entity} />;
    case 'sensor':
      return <SensorCard config={config} entity={entity} />;
    case 'cover':
      return <CoverCard config={config} entity={entity} />;
    case 'light':
      return <LightCard config={config} entity={entity} />;
    case 'switch':
      return <SwitchCard config={config} entity={entity} />;
    default:
      // 兼容旧配置：历史上 switch 实体可能被保存为 generic。
      if (entity.entity_id.startsWith('switch.')) return <SwitchCard config={{ ...config, type: 'switch' }} entity={entity} />;
      return <GenericCard config={config} entity={entity} />;
  }
}
