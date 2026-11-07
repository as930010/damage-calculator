import type { LayoutSlot } from './data.ts';
import type { LoadoutState } from './state.ts';
import type { CatalogIndex } from './catalog-index.ts';
import { configurationProgress } from './configuration-progress.ts';
import { validTransformationValue } from '../calculation/transformation-selections.ts';
import { circuitBoardRowsField, readCircuitBoardRows, validateCircuitBoardRows } from './circuit-board-rows.ts';

const dependencyCache = new WeakMap<CatalogIndex, Map<string, readonly string[]>>();
/** All possible mode-dependent fields, calculated once per catalog and slot. */
export function equipmentProgressFields(slot: LayoutSlot, index: CatalogIndex): readonly string[] {
  let slots = dependencyCache.get(index); if (!slots) { slots = new Map(); dependencyCache.set(index, slots); }
  const cached = slots.get(slot.id); if (cached) return cached;
  const data = index.data, fields = [...(slot.selectionField ? [slot.selectionField] : []), ...(slot.stoneFields ?? [])];
  if (slot.weapon) fields.push('Weapon.ENHC', data.growth.settingKey, ...Object.values(data.weaponAppraisals.groups).map(g=>g.settingKey), ...data.transformations.slots.flatMap(s=>[s.choiceField,s.valueField]));
  if (slot.innerwearId) {
    const armor = data.innerwear.slots.find(s=>s.id===slot.innerwearId)!;
    const nephron = data.nephronArmor.fields.find(s=>s.slotId===slot.innerwearId)!;
    const circuit = data.circuits.inputs.find(s=>s.slot===slot.innerwearId)!;
    const chip = data.chipSlots.slots.find(s=>s.id===slot.innerwearId)!;
    fields.push(armor.typeField, armor.enhancementField, armor.forgingField,
      ...data.appraisals.slots.find(s=>s.id===slot.innerwearId)!.inputFields,
      ...nephron.transformFields.flatMap(s=>[s.attributeField,s.valueField]), nephron.magazineField,nephron.magazineLevelField,
      circuit.attributeField,circuit.valueField,circuitBoardRowsField(circuit.attributeField),chip.attributeField,chip.tuningField);
  }
  if(slot.group==='accessories') fields.push(...(data.accessoryEffects.groups.find(g=>g.selectionField===slot.selectionField)?.inputFields ?? []));
  const result = Object.freeze([...new Set(fields)]); slots.set(slot.id,result); return result;
}
/** Fields shown as required choices must retain an actual unselected state. Optional boards keep their defaults. */
export function equipmentProgressChoiceFields(index: CatalogIndex): ReadonlySet<string> {
  const data=index.data;
  return new Set([...data.layout.slots.flatMap(s=>s.stoneFields??[]),...data.appraisals.slots.flatMap(s=>s.inputFields),
    ...data.nephronArmor.fields.flatMap(s=>s.transformFields.map(t=>t.attributeField)),
    ...data.accessoryEffects.groups.flatMap(s=>s.inputFields),...Object.values(data.weaponAppraisals.groups).map(g=>g.settingKey)]);
}
export function equipmentProgress(slot: LayoutSlot, state: LoadoutState, index: CatalogIndex) {
  const data=index.data, values=state.values, checks:boolean[]=[];let selected=false;
  const present=(f:string)=>values[f]!==undefined&&String(values[f]).trim()!=='';
  const choice=(f:string, choices?:readonly unknown[]|null)=>{
    if(!present(f))return false;
    const mapping=index.equipmentMappings.get(f);
    return mapping && choices===undefined ? index.matchEquipment(mapping,String(values[f])).length>0
      : Boolean((choices??index.resolveFieldChoices(f,values))?.some(v=>String(v)===String(values[f])));
  };
  const required=(f:string, choices?:readonly unknown[]|null)=>{const ok=choice(f,choices);checks.push(ok);if(ok)selected=true;return ok;};
  if(slot.selectionField) required(slot.selectionField);
  const armor=slot.innerwearId?data.innerwear.slots.find(s=>s.id===slot.innerwearId):undefined;
  const nephron=armor && values[armor.typeField]==='內布隆';
  for(const field of armor&&!nephron?slot.stoneFields?.slice(0,4)??[]:slot.stoneFields??[]) required(field);
  if(armor){
    required(armor.enhancementField);required(armor.forgingField);
    if(nephron){
      const f=data.nephronArmor.fields.find(s=>s.slotId===slot.innerwearId)!;
      const seen=new Set<string>();
      for(const t of f.transformFields){const valid=required(t.attributeField);const name=String(values[t.attributeField]??'');
        if(valid && name!=='無關傷害'){checks.push(!seen.has(name),choice(t.valueField));seen.add(name);}}
      if(present(f.magazineField)||present(f.magazineLevelField)){required(f.magazineField);required(f.magazineLevelField);}
    }else for(const f of data.appraisals.slots.find(s=>s.id===slot.innerwearId)!.inputFields)required(f);
    const circuit=data.circuits.inputs.find(s=>s.slot===slot.innerwearId)!;
    let boardAttributes: string[] = [];
    try {
      const savedRows = values[circuitBoardRowsField(circuit.attributeField)];
      const rows = present(circuitBoardRowsField(circuit.attributeField)) ? JSON.parse(String(savedRows))
        : readCircuitBoardRows(values,circuit.attributeField,circuit.valueField);
      if (!Array.isArray(rows)) throw new TypeError('Invalid circuit rows');
      // Validate stored rows before the editor's clamping can conceal an invalid value.
      validateCircuitBoardRows(rows,circuit.attributeOptions);
      const legacyValue = values[circuit.valueField];
      if (!savedRows && present(circuit.valueField) && values[circuit.attributeField] !== '無關傷害'
        && (!Number.isFinite(Number(legacyValue)) || Number(legacyValue)<0 || Number(legacyValue)>0.18)) checks.push(false);
      boardAttributes = rows.map(row=>row.attribute);
    } catch { checks.push(false); }
    const chip=data.chipSlots.slots.find(s=>s.id===slot.innerwearId)!;
    if(present(chip.attributeField)||present(chip.tuningField)){required(chip.attributeField);required(chip.tuningField);}
    // The editor forbids using the same conditional pants effect in both averaged paths.
    if (state.lowerwearAlternativeEnabled && !state.bossHealthCondition?.enabled
      && (armor.id==='lowerwear' || armor.id==='lowerwearAlternative')) {
      const peerId=armor.id==='lowerwear'?'lowerwearAlternative':'lowerwear';
      const peerChip=data.chipSlots.slots.find(s=>s.id===peerId)!;
      const attribute=values[chip.attributeField];
      if ((attribute==='強者%' || attribute==='排熱%') && attribute===values[peerChip.attributeField]) checks.push(false);
      const peerBoard=data.circuits.inputs.find(s=>s.slot===peerId)!;
      try {
        const peers=readCircuitBoardRows(values,peerBoard.attributeField,peerBoard.valueField);
        if (boardAttributes.some(name=>(name==='強者%' || name==='排熱%') && peers.some(row=>row.attribute===name))) checks.push(false);
      } catch { /* Invalid peer data cannot complete this slot's own optional board. */ }
    }
  }
  if(slot.weapon){
    required('Weapon.ENHC');required(data.growth.settingKey);
    for(const g of Object.values(data.weaponAppraisals.groups))required(g.settingKey);
    const seen=new Set<string>();
    for(const t of data.transformations.slots){const rule=data.transformations.rules.find(r=>r.choice===values[t.choiceField]);
      const valid=required(t.choiceField);checks.push(Boolean(rule&&validTransformationValue(rule,values[t.valueField]))&&!seen.has(String(values[t.choiceField])));if(valid)seen.add(String(values[t.choiceField]));}
  }
  if(slot.group==='accessories'&&slot.selectionField&&choice(slot.selectionField)){
    const mapping=index.equipmentMappings.get(slot.selectionField)!;
    const item=index.equipmentItems(mapping).find(item=>item.name===values[slot.selectionField!]);
    const appraisal=item?.appraisal;
    if(appraisal?.canAppraise!==false){
      const group=data.accessoryEffects.groups.find(g=>g.selectionField===slot.selectionField);
      if(!group||!appraisal||appraisal.canAppraise!==true||!Number.isInteger(appraisal.effectCount)||!appraisal.effectCount||appraisal.effectCount>group.inputFields.length)checks.push(false);
      else {const options=(group.optionsByEquipmentName?.[item!.name]??group.options).map(o=>o.name);for(const f of group.inputFields.slice(0,appraisal.effectCount))required(f,options);}
    }
  }
  return configurationProgress(checks,selected);
}
