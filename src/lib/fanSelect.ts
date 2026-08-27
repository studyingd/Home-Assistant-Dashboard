import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

/** 识别风速挡位 select 实体的关键词,按可信度排列(越靠前越可信) */
export const FAN_KEYWORDS = [
  'fan_level',
  'fan_speed',
  'fanspeed',
  '风速',
  '风挡',
  '挡位',
  '档位',
  'fan',
  '风',
];

/** 返回文本命中的最高优先级关键词索引;无命中返回 -1 */
export function fanKeywordScore(text: string): number {
  const lower = text.toLowerCase();
  for (let i = 0; i < FAN_KEYWORDS.length; i++) {
    if (lower.includes(FAN_KEYWORDS[i])) return i;
  }
  return -1;
}

/**
 * 判断 select 实体与空调是否同源(注册表不可用时的兜底之一):
 * 前缀关系(climate.qdhkl_ac_0103 ↔ select.qdhkl_ac_0103_fan_level)
 * 或分词全包含(climate.ac_0103 ↔ select.qdhkl_ac_0103_fan_speed)
 */
export function sameSource(climateBase: string, selectBase: string): boolean {
  if (!climateBase) return false;
  if (selectBase === climateBase || selectBase.startsWith(`${climateBase}_`)) return true;
  const baseTokens = climateBase.split('_').filter(Boolean);
  if (baseTokens.length < 2) return false;
  const selectTokens = new Set(selectBase.split('_'));
  return baseTokens.every((t) => selectTokens.has(t));
}

/** select 实体末尾的风速关键词段 + 可选实例后缀(_2/_3) */
const FAN_SUFFIX_RE = /_(fan_level|fan_speed|fanspeed|fan_mode|风速|风挡|挡位|档位|fan)(?:_(\d+))?$/;
/** climate 实体末尾的空调词段 + 可选实例后缀(_2/_3) */
const CLIMATE_SUFFIX_RE = /_(air_conditioner|air_cond|空调)(?:_(\d+))?$/;

/** 拆出「主干 + 实例号」:qdhkl_ac_0103_air_conditioner_2 → {qdhkl_ac_0103, 2} */
function splitStem(base: string, re: RegExp): { stem: string; inst: string } | null {
  const m = re.exec(base);
  if (!m || m.index === undefined || m.index === 0) return null;
  return { stem: base.slice(0, m.index), inst: m[2] ?? '' };
}

export type FanSelectVia = 'device' | 'stem' | 'id';

export interface FanSelectResult {
  /** 命中的 select 实体;未命中为 null */
  entity: HassEntity | null;
  /** 命中方式:同设备关联 / 词干配对 / ID 匹配,用于诊断 */
  via: FanSelectVia | null;
}

const VIA_RANK: Record<FanSelectVia, number> = { device: 0, stem: 1, id: 2 };

/**
 * 为某台空调寻找风速挡位 select 实体。
 * 1) 优先实体注册表的同设备关联;
 * 2) 词干配对:qdhkl_ac_0103_air_conditioner(_2) ↔ qdhkl_ac_0103_fan_level(_2),
 *    实例后缀必须一致,避免一台外机的多台风管内机互相串挡位;
 * 3) 实体 ID 前缀/分词匹配。
 * 注意:即使 climate 自带 fan_modes 也照常寻找——部分集成(如海尔 qdhkl)
 * 两套并存,select 才是挡位更全的实际控制。
 */
export function findFanSelect(
  entityId: string,
  states: HassEntities | null,
  entityDevice: Map<string, string> | null,
): FanSelectResult {
  if (!states) return { entity: null, via: null };
  const base = entityId.split('.')[1] ?? '';
  const deviceId = entityDevice?.get(entityId);
  const climateStem = splitStem(base, CLIMATE_SUFFIX_RE);

  let best: HassEntity | null = null;
  let bestVia: FanSelectVia | null = null;
  let bestScore = Infinity;
  let bestStemOk = false;

  for (const [id, st] of Object.entries(states)) {
    if (!id.startsWith('select.')) continue;
    const selBase = id.split('.')[1] ?? '';
    const selStem = splitStem(selBase, FAN_SUFFIX_RE);
    const stemOk = !!(
      climateStem &&
      selStem &&
      selStem.stem === climateStem.stem &&
      selStem.inst === climateStem.inst
    );

    const linked = deviceId !== undefined && entityDevice?.get(id) === deviceId;
    let via: FanSelectVia | null = linked ? 'device' : null;
    if (!via && stemOk) via = 'stem';
    if (!via && sameSource(base, selBase)) via = 'id';
    if (!via) continue;

    const name = (st.attributes?.friendly_name as string) ?? '';
    const score = fanKeywordScore(`${id} ${name}`);
    if (score === -1) continue;

    // 排序:词干+实例完全一致 > 关联方式更可信 > 关键词命中更强。
    // stemOk 置顶是为了防「一拖多」:同一 device_id 下挂多台风管内机时,
    // 设备关联会命中多个 select,必须靠实例后缀区分
    const better =
      best === null ||
      (stemOk && !bestStemOk) ||
      (stemOk === bestStemOk &&
        (VIA_RANK[via] < VIA_RANK[bestVia as FanSelectVia] ||
          (VIA_RANK[via] === VIA_RANK[bestVia as FanSelectVia] && score < bestScore)));
    if (better) {
      best = st;
      bestVia = via;
      bestScore = score;
      bestStemOk = stemOk;
    }
  }

  return { entity: best, via: best ? bestVia : null };
}
