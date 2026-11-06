import { escapeHtml as h, formatNumber as fmt, type GameData } from './data.ts';
import { DEFAULT_BOSS_HEALTH_CONDITION, type BossHealthCondition } from './state.ts';
import { readCircuitBoardRows } from './circuit-board-rows.ts';
import { attributeLabel } from './attribute-label.ts';

export interface SourceLabelSelection {
  readonly values: Readonly<Record<string, string | number>>;
  readonly bossHealthCondition?: Readonly<BossHealthCondition>;
}

export function sourceLabel(sourceId: string, data: GameData, state: SourceLabelSelection): string {
  return attributeLabel(resolveSourceLabel(sourceId, data, state));
}

function resolveSourceLabel(sourceId: string, data: GameData, state: SourceLabelSelection): string {
  const bossHealthCondition = () => state.bossHealthCondition ?? DEFAULT_BOSS_HEALTH_CONDITION;
  if (sourceId === 'character-base') return '角色基礎係數';
  if (sourceId === 'character-base:crit-damage-product') return '角色原始乘算爆傷基準';
  if (sourceId === 'weapon-base-attack') return '武器基礎攻擊力';
  if (sourceId === 'hunter-instinct') return '獵人的本能(公會技能)';
  if (sourceId.startsWith('master-beast-potential:')) return '聖獸潛力';
  const configuredSourceLabels: Readonly<Record<string, string>> = {
    'fixed-effect:master-beast': '大師聖獸固定效果',
    'fixed-effect:pet-skill': '寵物被動',
    'fixed-effect:raid-set': '百億／內布隆套效',
    'fixed-effect:weapon': '武器',
    'fixed-effect:title-adaptability': '稱號',
    'fixed-effect:title-defense-ignore': '稱號',
    'fixed-effect:red-upper-crit-damage': '百億紅上衣、暴上',
    'fixed-effect:maestro-aura': 'MAESTRO光環',
    'special-potion:nut-protection': '努特的庇護',
    'nephron-raid:grett-medal': '內布隆襲擊戰',
    'grett-medal:super-magazines': '格雷特的勳章：超級彈匣加成',
    'grett-medal:support-magazines': '格雷特的勳章：支援彈匣加成',
    'grett-medal:classic-combat-magazines': '格雷特的勳章：經典／戰鬥彈匣加成',
    'combat-rate:yellow-beast-stone': '黃色聖獸精靈石效果',
    'combat-rate:lowerwear-enhancement': bossHealthCondition().enabled && bossHealthCondition().lowerwear === 'lowerwearB' ? '強/排褲強化爆擊效果' : '下衣強化爆擊效果',
    'combat-rate:shoes-enhancement': '鞋子強化極大效果',
  };
  if (configuredSourceLabels[sourceId]) return configuredSourceLabels[sourceId];
  if (sourceId.startsWith('class-passive:')) {
    const [, classId, kind] = sourceId.split(':');
    if (kind === 'boss-damage') return classId + '自身技能';
    if (kind === 'multiplicative-crit-damage') {
      if (sourceId === 'class-passive:CU:multiplicative-crit-damage:1') return '解放意志';
      if (sourceId === 'class-passive:MN:multiplicative-crit-damage:2') return 'MN 硝基馬達';
      if (['TB', 'BMa', 'MN', 'PO'].includes(classId)) return classId + ' 爆發模式';
      if (['CT', 'IN', 'DA', 'DE'].includes(classId)) return classId + ' 懲戒紋章';
      return classId + '自身技能（乘算爆傷）';
    }
  }
  if (sourceId.startsWith('simulator:')) {
    const fieldId = sourceId.slice('simulator:'.length);
    const stoneSlot = data.layout.slots.find(entry => entry.stoneFields?.includes(fieldId));
    const selectedSlots = data.layout.slots.filter(entry => entry.selectionField === fieldId);
    const slot = stoneSlot ?? selectedSlots[0];
    const selected = String(state.values[fieldId] ?? '').trim();
    if (stoneSlot) {
      if (stoneSlot.group === 'weapon' || stoneSlot.group === 'iceWeapon') return `武器魔法石(含冰武)：${selected}`;
      const includesIce = ['上衣', '下衣', '手套', '鞋子'].includes(stoneSlot.label);
      return `${stoneSlot.label}魔法石${includesIce ? '(含冰裝)' : ''}：${selected}`;
    }
    if (selectedSlots.length > 1) {
      const group = data.layout.groups.find(entry => entry.id === selectedSlots[0].group);
      return `${group?.name ?? selectedSlots[0].group}套裝：${selected}`;
    }
    if (slot) return `${slot.label}：${selected}`;
    return `裝備選擇（${fieldId}）${selected ? `：${selected}` : ''}`;
  }
  if (sourceId.startsWith('nephron-transform:')) {
    const [, slotId, line] = sourceId.split(':');
    const field = data.nephronArmor.fields.find(entry => entry.slotId === slotId);
    const index = Number(line) - 1;
    const attributeField = field && index >= 0 ? field.transformFields[index]?.attributeField : undefined;
    const attribute = attributeField ? String(state.values[attributeField] ?? '') : '';
    const partNames: Record<string, string> = { Upper: '上衣', Lowerwear: '下衣', LowerwearAlternative: '強/排褲', Gloves: '手套', Shoes: '鞋子' };
    return '內布隆' + (partNames[field?.part ?? ''] ?? field?.part ?? '') + '變換：' + attribute;
  }
  if (sourceId.startsWith('nephron-magazine:')) {
    const [, slotId, magazineId, level] = sourceId.split(':');
    const field = data.nephronArmor.fields.find(entry => entry.slotId === slotId);
    const magazine = data.nephronArmor.magazines.find(entry => entry.id === magazineId);
    const partNames: Record<string, string> = { Upper: '上衣', Lowerwear: '下衣', LowerwearAlternative: '強/排褲', Gloves: '手套', Shoes: '鞋子' };
    return '內布隆' + (partNames[field?.part ?? ''] ?? field?.part ?? '') + '彈匣：' + (magazine?.name ?? magazineId) + ' ' + level;
  }
  if (sourceId.startsWith('innerwear:')) {
    const slot = data.innerwear.slots.find(entry => entry.id === sourceId.slice('innerwear:'.length));
    return slot ? `內裝${slot.name}（強化／鍛造）` : `內裝來源待確認（${sourceId}）`;
  }
  if (sourceId === 'spirit-record:default-maxed') return '賦靈錄';
  if (sourceId.startsWith('spirit-record:branch:')) return `賦靈錄：${sourceId.slice('spirit-record:branch:'.length)}`;
  if (sourceId.startsWith('spirit-record:trait:')) return `賦靈錄特性：${sourceId.slice('spirit-record:trait:'.length)}`;
  if (sourceId.startsWith('chip:')) {
    const slotId = sourceId.slice('chip:'.length);
    const slot = data.chipSlots.slots.find(entry => entry.id === slotId);
    const slotNames: Record<string, string> = { upper: '上衣', lowerwear: '下衣', lowerwearAlternative: '強/排褲', gloves: '手套', shoes: '鞋子' };
    return slot ? `${slotNames[slot.id] ?? slot.id}芯片：${String(state.values[slot.attributeField] ?? '')}（調校 ${String(state.values[slot.tuningField] ?? '')}）` : `芯片調校來源待確認（${sourceId}）`;
  }
  if (sourceId.startsWith('circuit-board:')) {
    const [slotId, rowNumber] = sourceId.slice('circuit-board:'.length).split(':');
    const slot = data.circuits.inputs.find(entry => entry.slot === slotId);
    if (rowNumber && slot) {
      const row = readCircuitBoardRows(state.values, slot.attributeField, slot.valueField)[Number(rowNumber) - 1];
      const slotNames: Record<string, string> = { upper: '上衣', lowerwear: '下衣', lowerwearAlternative: '強/排褲', gloves: '手套', shoes: '鞋子' };
      if (row) return (slotNames[slotId] ?? slotId) + '電路板第 ' + rowNumber + ' 列：' + row.attribute + ' ' + fmt((row.percentageValue ?? 0) * 100) + '%';
    }
    const slotNames: Record<string, string> = { upper: '上衣電路板', lowerwear: '下衣電路板', lowerwearAlternative: '強/排褲電路板', gloves: '手套電路板', shoes: '鞋子電路板' };
    if (slotNames[slotId] && !rowNumber) return slotNames[slotId];
    return slot ? `電路板 ${slotId}：${String(state.values[slot.attributeField] ?? '')} ${fmt(Number(state.values[slot.valueField] ?? 0) * 100)}%` : `電路板來源待確認（${sourceId}）`;
  }
  if (sourceId === '立繪、覺醒:Effect.PortraitAwakening') return '立繪、覺醒';
  if (sourceId.startsWith('color-set:')) return `百億套效：${sourceId.slice('color-set:'.length)}`;
  if (sourceId.startsWith('master-beast:')) {
    const [, part, detail] = sourceId.split(':');
    const partNames: Record<string, string> = { head: '頭飾', ring: '指環' };
    if (part === 'mirror') {
      return '聖獸迷鏡效果';
    }
    if (part === 'head-manual') return `聖獸頭飾精靈石：${String(state.values['MasterBeast.Head.CustomAttribute'] ?? '')}`;
    if (part === 'necklace-manual') return `聖獸項鍊精靈石：${String(state.values['MasterBeast.Necklace.CustomAttribute'] ?? '')}`;
    if (part === 'ring-manual') {
      const fieldId = detail === '1' ? 'MasterBeast.Ring1.CustomAttribute' : 'MasterBeast.Ring2.CustomAttribute';
      return `聖獸指環精靈石：${String(state.values[fieldId] ?? '')}`;
    }
    if (partNames[part]) {
      const fieldId = part === 'head' ? detail === '1' ? 'MasterBeast.Head.Option1' : 'MasterBeast.Head.Option2' : detail === '1' ? 'MasterBeast.Ring1.Option1' : 'MasterBeast.Ring2.Option1';
      return `聖獸${partNames[part]}固定效果：${String(state.values[fieldId] ?? '')}`;
    }
  }
  const rightIce = data.rightIceSets.effects.find(entry => entry.id === sourceId);
  if (rightIce) return `右冰套效：${rightIce.setName}`;
  const resonance = data.resonance.effects.find(entry => entry.id === sourceId);
  if (resonance) return `共鳴：${resonance.name}`;
  const raid = data.raidSets.sets.find(entry => sourceId.startsWith(`${entry.id}:`));
  if (raid) return `襲擊套效：${raid.name}（${sourceId.slice(raid.id.length + 1)}）`;
  const atma = data.atma.rules.find(entry => entry.id === sourceId);
  const atmaNames: Record<string, string> = {
    'atma-wood-crit-rate': '草木亞特瑪致命一擊',
    'atma-water-fire-multiplicative-damage': '流水 / 火焰亞特瑪套效',
    'atma-wood-multiplicative-crit-damage': '草木亞特瑪乘算致命傷害',
  };
  if (atma) return atmaNames[atma.id] ?? `亞特瑪來源待確認（${atma.id}）`;
  if (sourceId.startsWith('weapon-growth')) return `武器成長：${String(state.values[data.growth.settingKey] ?? '')}`;
  if (sourceId.startsWith('weapon-appraisal:')) {
    const fieldId = sourceId.slice('weapon-appraisal:'.length);
    const group = Object.values(data.weaponAppraisals.groups).find(entry => entry.settingKey === fieldId);
    return `武器鑑定${group ? `：${String(state.values[fieldId] ?? '')}` : ''}`;
  }
  if (sourceId.startsWith('giant-stone:')) {
    return '巨型魔力石';
  }
  if (sourceId.startsWith('weapon-magic-stone:')) {
    const colorId = sourceId.split(':')[1];
    return `${data.weaponGrades.colorGroups.find(group => group.id === colorId)?.name ?? '武器魔力石'}效果`;
  }
  if (sourceId.startsWith('weapon-grade:')) return '武器魔力石';
  if (sourceId.startsWith('weapon-transform:')) {
    return '武器變換';
  }
  if (sourceId.startsWith('armor-appraisal:')) {
    const slotId = sourceId.split(':')[1];
    const slot = data.appraisals.slots.find(entry => entry.id === slotId);
    const slotNames: Record<string, string> = { upper: '上衣', lowerwear: '下衣', lowerwearAlternative: '強/排褲', gloves: '手套', shoes: '鞋子' };
    return slot ? `內裝${slotNames[slot.id] ?? slot.id}鑑定` : `防具鑑定來源待確認（${sourceId}）`;
  }
  if (sourceId.startsWith('accessory-effect:')) {
    const groupId = sourceId.split(':')[1];
    const group = data.accessoryEffects.groups.find(entry => entry.id === groupId);
    return group ? `${group.label}鑑定` : `飾品效果來源待確認（${sourceId}）`;
  }
  if (sourceId.startsWith('title:')) return `稱號：${String(state.values['Effect.Title'] ?? '')}`;
  if (sourceId.startsWith('consumable:')) return `消耗品：${String(state.values['Effect.Consumable'] ?? '')}`;
  if (sourceId.startsWith('environment:')) return `場地：${String(state.values['Effect.Environment'] ?? '')}`;
  if (sourceId.startsWith('peak-option:')) return `巔峰選項：${String(state.values['Peak.Option'] ?? '')}`;
  if (sourceId.startsWith('pet:')) return `寵物：${String(state.values['Pet.Passive'] ?? '')}`;
  if (sourceId === '標誌:Effect.Emblem') return '標誌';
  const binaryEffect = data.otherEffects.binaryEffects.find(entry => entry.name === sourceId);
  if (binaryEffect) return `${binaryEffect.name}：${String(state.values[binaryEffect.settingKey] ?? '')}`;
  if (sourceId.startsWith('guild-fountain-')) {
    return '公會噴泉';
  }
  if (sourceId === 'lowerwear-crit-rate-enhancement') return '下衣強化階段+2';
  if (sourceId === 'shoes-extremization-enhancement') return '鞋子強化階段+2';
  if (sourceId === 'master-beast:armor-spirit-stone-set') return '聖獸精靈石套效';
  const classPassiveSource = sourceId.match(/^([^:]+):(critRate|extremization):(crit|ext)-\d+$/);
  if (classPassiveSource && data.classCombatEffects.classes[classPassiveSource[1]]) return classPassiveSource[1] + '自身技能';
  return `來源名稱待確認（${sourceId}）`;
}

export function renderSourceRows(sources: readonly { sourceId: string; valuePct: number }[], isPercent: boolean, sourceLabel: (sourceId: string) => string): string {
  const totals = new Map<string, number>();
  for (const source of sources) {
    const label = sourceLabel(source.sourceId);
    totals.set(label, (totals.get(label) ?? 0) + source.valuePct);
  }
  return [...totals].map(([label, total]) =>
    `<p class="stat-source-row"><span>${h(label)}</span><strong>${fmt(total)}${isPercent ? '%' : ''}</strong></p>`,
  ).join('');
}
