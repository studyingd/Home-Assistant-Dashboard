import type { Region } from '../lib/types';

/**
 * ============================================================
 *  首次运行种子配置
 * ============================================================
 *
 * 区域和设备现在直接在界面里管理(顶栏「编辑」模式):
 *   - 顶部导航是一级区域标签;编辑模式下末尾「⊕ 新建区域」可新增,
 *     当前标签旁的 ✎/🗑 可改名/删除。
 *   - 选中区域后,页面平铺展示该区域的所有「区域块」,
 *     块内「+ 添加设备」从 Home Assistant 实体列表中挑选设备。
 * 下面的种子数据仅用于管理员重置配置或首次初始化数据库时生成初始值；
 * 正常运行时配置由 PostgreSQL/API 统一持久化。
 */

export const DASHBOARD_TITLE = 'Seeed 办公环境中控';

export const seedRegions: Region[] = [
  {
    id: 'living-room',
    name: '客厅',
    blocks: [
      {
        id: 'living-room-climate',
        name: '环境',
        icon: 'thermometer',
        devices: [
          { entity_id: 'climate.living_room_ac', type: 'climate', name: '空调' },
          { entity_id: 'sensor.living_room_co2', type: 'sensor', name: '二氧化碳' },
        ],
      },
      {
        id: 'living-room-shade',
        name: '遮阳',
        icon: 'curtain',
        devices: [
          {
            entity_id: 'cover.living_room_curtain',
            type: 'cover',
            name: '窗帘',
            coverVariant: 'curtain',
          },
          {
            entity_id: 'cover.living_room_window',
            type: 'cover',
            name: '窗户',
            coverVariant: 'window',
          },
        ],
      },
    ],
  },
  {
    id: 'bedroom',
    name: '卧室',
    blocks: [
      {
        id: 'bedroom-climate',
        name: '环境',
        icon: 'thermometer',
        devices: [
          { entity_id: 'climate.bedroom_ac', type: 'climate', name: '空调' },
          { entity_id: 'sensor.bedroom_co2', type: 'sensor', name: '二氧化碳' },
        ],
      },
      {
        id: 'bedroom-shade',
        name: '遮阳',
        icon: 'curtain',
        devices: [
          {
            entity_id: 'cover.bedroom_curtain',
            type: 'cover',
            name: '窗帘',
            coverVariant: 'curtain',
          },
        ],
      },
    ],
  },
];
