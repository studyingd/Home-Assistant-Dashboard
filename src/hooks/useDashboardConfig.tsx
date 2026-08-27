/**
 * 看板配置(区域/区域块 + 当前激活区域)Provider。
 * 持久化:服务器 PostgreSQL(/api/config,唯一权威来源)。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DashboardConfig, DeviceConfig, Region } from '../lib/types';
import { DASHBOARD_TITLE } from '../config/dashboard';
import { fetchRemoteConfig, pushRemoteConfig } from '../lib/configSync';
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from '../lib/storage';
import {
  addDevicesToBlock,
  buildSeedConfig,
  insertBlock,
  insertRegion,
  moveBlock,
  moveDevice,
  moveRegion,
  newId,
  removeBlock,
  removeDeviceFromBlock,
  removeRegion,
  updateBlock,
  updateDevice,
  updateRegion,
} from '../lib/regions';

/** 业务配置只来自 PostgreSQL；初始空值仅用于等待首次远程读取。 */
function loadInitialConfig(): DashboardConfig {
  return { schemaVersion: 2, title: DASHBOARD_TITLE, regions: [] };
}

/** 读取上次激活的一级区域；无效时回退第一个区域 */
function loadInitialActive(regions: Region[]): string | null {
  const stored = readStorage(STORAGE_KEYS.activeRegion);
  if (stored && regions.some((r) => r.id === stored)) return stored;
  return regions[0]?.id ?? null;
}

export interface DashboardConfigContextValue {
  config: DashboardConfig;
  /** 一级区域列表(= config.regions) */
  regions: Region[];
  /** 当前激活区域 id;null = 没有任何区域 */
  activeRegionId: string | null;
  /** 当前激活区域;无匹配时回退第一个区域,均无则 null */
  activeRegion: Region | null;
  setActiveRegion: (id: string) => void;
  /** 返回新区域 id */
  addRegion: (name: string, icon?: string) => string;
  changeRegion: (id: string, patch: { name?: string; icon?: string; hiddenFromUsers?: boolean }) => void;
  deleteRegion: (id: string) => void;
  /** 拖动排序:把 dragId 区域移到 targetId 之前/之后 */
  moveRegion: (dragId: string, targetId: string, after: boolean) => void;
  /** 返回新区域块 id */
  addBlock: (regionId: string, name: string, icon?: string) => string;
  changeBlock: (blockId: string, patch: { name?: string; icon?: string; hiddenFromUsers?: boolean }) => void;
  deleteBlock: (blockId: string) => void;
  /** 拖动排序:在 regionId 内把 dragId 区域块移到 targetId 之前/之后 */
  moveBlock: (regionId: string, dragId: string, targetId: string, after: boolean) => void;
  addDevices: (blockId: string, devices: DeviceConfig[]) => void;
  /** 改设备自定义名/图标;字段为空则恢复自动(跟随 HA 名 / 自动图标) */
  changeDevice: (blockId: string, entityId: string, patch: { name?: string; icon?: string; hiddenFromUsers?: boolean }) => void;
  /** 拖动排序:在 blockId 内把 dragEntityId 设备移到 targetEntityId 之前/之后 */
  moveDevice: (blockId: string, dragEntityId: string, targetEntityId: string, after: boolean) => void;
  removeDevice: (blockId: string, entityId: string) => void;
  resetToSeed: () => void;
  syncError: string | null;
  retrySync: () => void;
}

const DashboardConfigContext = createContext<DashboardConfigContextValue | null>(null);

export function DashboardConfigProvider({
  children,
  canEdit = false,
}: {
  children: ReactNode;
  canEdit?: boolean;
}) {
  const [config, setConfig] = useState<DashboardConfig>(loadInitialConfig);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(() =>
    loadInitialActive(config.regions),
  );

  // 始终指向最新 config(供「服务器为空时把本地/种子上传为共享配置」用)
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  // 首次从服务器拉取完成后,才允许把改动写回服务器(避免初始本地值覆盖共享配置)
  const hydratedRef = useRef(false);

  // 启动拉取共享配置:服务器是唯一业务配置来源;数据库为空时仅管理员可初始化。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let remote;
      try {
        remote = await fetchRemoteConfig();
      } catch {
        if (!cancelled) setSyncError('无法读取 PostgreSQL 配置，请检查数据库连接。');
        return;
      }
      if (cancelled) return;
      if (remote.status === 'ok') {
        setConfig(remote.config);
      } else if (remote.status === 'empty' && canEdit) {
        try {
          await pushRemoteConfig(configRef.current);
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : '数据库初始化失败');
          return;
        }
      } else if (remote.status === 'empty') {
        setSyncError('数据库尚未初始化，请先由管理员登录完成初始化。');
        return;
      } else {
        setSyncError('无法读取 PostgreSQL 配置，请检查数据库连接。');
        return;
      }
      setSyncError(null);
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, syncAttempt]);

  // 写穿持久化:数据库写入失败时显示错误，不静默保留本地业务副本。
  useEffect(() => {
    if (hydratedRef.current && canEdit && !syncError) {
      pushRemoteConfig(config).catch((error) => setSyncError(error instanceof Error ? error.message : '配置保存失败'));
    }
  }, [config, canEdit, syncError]);

  const regions = config.regions;
  // 无匹配(被删除/失效)时回退第一个区域
  const activeRegion = regions.find((r) => r.id === activeRegionId) ?? regions[0] ?? null;
  const resolvedId = activeRegion?.id ?? null;

  // 把回退结果同步回 state,并持久化激活区域
  useEffect(() => {
    if (resolvedId !== activeRegionId) setActiveRegionId(resolvedId);
  }, [resolvedId, activeRegionId]);
  useEffect(() => {
    if (resolvedId) writeStorage(STORAGE_KEYS.activeRegion, resolvedId);
    else removeStorage(STORAGE_KEYS.activeRegion);
  }, [resolvedId]);

  const value = useMemo<DashboardConfigContextValue>(
    () => ({
      config,
      regions,
      activeRegionId: resolvedId,
      activeRegion,
      setActiveRegion: (id) => setActiveRegionId(id),
      addRegion: (name, icon) => {
        const node: Region = { id: newId(), name: name.trim(), icon, blocks: [] };
        setConfig((prev) => ({ ...prev, regions: insertRegion(prev.regions, node) }));
        return node.id;
      },
      changeRegion: (id, patch) =>
        setConfig((prev) => ({ ...prev, regions: updateRegion(prev.regions, id, patch) })),
      deleteRegion: (id) =>
        setConfig((prev) => ({ ...prev, regions: removeRegion(prev.regions, id) })),
      moveRegion: (dragId, targetId, after) =>
        setConfig((prev) => ({
          ...prev,
          regions: moveRegion(prev.regions, dragId, targetId, after),
        })),
      addBlock: (regionId, name, icon) => {
        const block = { id: newId(), name: name.trim(), icon, devices: [] };
        setConfig((prev) => ({ ...prev, regions: insertBlock(prev.regions, regionId, block) }));
        return block.id;
      },
      changeBlock: (blockId, patch) =>
        setConfig((prev) => ({ ...prev, regions: updateBlock(prev.regions, blockId, patch) })),
      deleteBlock: (blockId) =>
        setConfig((prev) => ({ ...prev, regions: removeBlock(prev.regions, blockId) })),
      moveBlock: (regionId, dragId, targetId, after) =>
        setConfig((prev) => ({
          ...prev,
          regions: moveBlock(prev.regions, regionId, dragId, targetId, after),
        })),
      addDevices: (blockId, devices) =>
        setConfig((prev) => ({ ...prev, regions: addDevicesToBlock(prev.regions, blockId, devices) })),
      changeDevice: (blockId, entityId, patch) =>
        setConfig((prev) => ({
          ...prev,
          regions: updateDevice(prev.regions, blockId, entityId, patch),
        })),
      moveDevice: (blockId, dragEntityId, targetEntityId, after) =>
        setConfig((prev) => ({
          ...prev,
          regions: moveDevice(prev.regions, blockId, dragEntityId, targetEntityId, after),
        })),
      removeDevice: (blockId, entityId) =>
        setConfig((prev) => ({
          ...prev,
          regions: removeDeviceFromBlock(prev.regions, blockId, entityId),
        })),
      resetToSeed: () => {
        const seed = buildSeedConfig();
        setConfig(seed);
        setActiveRegionId(seed.regions[0]?.id ?? null);
      },
      syncError,
      retrySync: () => setSyncAttempt((value) => value + 1),
    }),
    [config, regions, activeRegion, resolvedId, syncError],
  );

  return <DashboardConfigContext.Provider value={value}>{children}</DashboardConfigContext.Provider>;
}

export function useDashboardConfig(): DashboardConfigContextValue {
  const ctx = useContext(DashboardConfigContext);
  if (!ctx) throw new Error('useDashboardConfig 必须在 DashboardConfigProvider 内使用');
  return ctx;
}
