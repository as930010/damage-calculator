import type { DamageBase } from '../calculation/types.ts';
import { damageDraftJournalKey, damageDraftKey, normalizeDamageBase, validDamageBase } from './damage-basis-state.ts';

const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 8 });
export const attributePercent = (value: number) => number.format(value) + '%';
const inputNumber = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 3 });

function normalizeInput(text: string): string | undefined {
  const digits = text.replace(/[０-９．]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
  return /^\d*(?:\.\d*)?$/.test(digits) ? digits.replace(/(\.\d{3})\d+$/, '$1') : undefined;
}

export const damageBasisMarkup = `
<section class="panel damage-basis" data-damage-basis aria-labelledby="damage-basis-heading">
  <div class="panel-heading"><h2 id="damage-basis-heading">基礎傷害屬性設定</h2></div>
  <div class="damage-basis-fields">
    <label>致命傷害（%）<input inputmode="decimal" type="text" data-damage-attribute="critDamagePct" aria-describedby="damage-basis-help"></label>
    <label>Boss 傷害（%）<input inputmode="decimal" type="text" data-damage-attribute="bossDamagePct" aria-describedby="damage-basis-help"></label>
    <button type="button" class="site-button" data-damage-reference>引用目前配裝</button>
  </div>
  <p class="panel-note" id="damage-basis-help">Boss傷害請填面板%數。如果職業有影響致命傷害、Boss傷害的Buff時請自行扣除，避免重複計算。</p>
  <p class="panel-note" id="damage-basis-status" data-damage-status role="status"></p>
</section>`;

export function mountDamageBasis(root: HTMLElement, initial: DamageBase, save: (base: DamageBase) => boolean) {
  const button = root.querySelector<HTMLButtonElement>('[data-damage-reference]')!;
  const status = root.querySelector<HTMLElement>('[data-damage-status]')!;
  const fields = [...root.querySelectorAll<HTMLInputElement>('[data-damage-attribute]')].map(input => ({
    input, key: input.dataset.damageAttribute as keyof DamageBase, draft: '',
  }));
  let base = normalizeDamageBase(initial) ?? initial;
  let edits = 0;

  function clearInvalid(input: HTMLInputElement) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
  }
  function fillField(field: typeof fields[number]) {
    field.draft = inputNumber.format(base[field.key]);
    field.input.value = field.draft;
    clearInvalid(field.input);
  }
  const hasInvalidField = () => fields.some(field => field.input.hasAttribute('aria-invalid'));
  fields.forEach(fillField);

  for (const field of fields) {
    const { input, key } = field;
    const updateInput = () => {
      edits++;
      const draft = normalizeInput(input.value);
      field.draft = draft ?? field.draft;
      if (input.value !== field.draft) {
        const caret = Math.min(input.selectionStart ?? field.draft.length, field.draft.length);
        input.value = field.draft;
        input.setSelectionRange(caret, caret);
      }
      if (draft === undefined) {
        status.textContent = '請使用數字與一個小數點，最多三位小數。仍使用上次有效值。';
        return;
      }
      const next = { ...base, [key]: Number(draft) };
      if (!/\d$/.test(draft) || !validDamageBase(next)) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-errormessage', status.id);
        status.textContent = key === 'critDamagePct' ? '請輸入大於 0 的致命傷害百分比。仍使用上次有效值。' : '請輸入非負的 Boss 傷害百分比。仍使用上次有效值。';
        return;
      }
      clearInvalid(input);
      base = next;
      const saved = save(base);
      if (!hasInvalidField()) status.textContent = saved ? '' : '已套用，目前無法儲存。';
    };

    input.addEventListener('input', event => {
      if (!(event as InputEvent).isComposing) updateInput();
    });
    input.addEventListener('compositionend', updateInput);
    input.addEventListener('blur', () => {
      const wasInvalid = input.hasAttribute('aria-invalid');
      fillField(field);
      if (wasInvalid && !hasInvalidField()) status.textContent = '';
    });
  }

  button.addEventListener('click', async () => {
    const editAtStart = edits;
    button.disabled = true;
    status.textContent = '正在讀取目前工作草稿…';
    try {
      const storage = window.localStorage;
      const raw = storage.getItem(damageDraftKey);
      if (!raw) throw Error('找不到已保存的工作草稿。');
      if (storage.getItem(damageDraftJournalKey)) throw Error('首頁正在切換配置，請稍後再引用。');
      const moduleUrl = document.querySelector<HTMLMetaElement>('meta[name="beneficiary-defense-url"]')?.content;
      const dataUrl = document.querySelector<HTMLMetaElement>('meta[name="beneficiary-data-url"]')?.content;
      if (!moduleUrl || !dataUrl) throw Error('此建置無法引用傷害計算機配裝。');
      const bridge = await import(new URL(moduleUrl, document.baseURI).href) as {
        readBeneficiaryDamage(url: string, raw: string): Promise<DamageBase>
      };
      const next = normalizeDamageBase(await bridge.readBeneficiaryDamage(new URL(dataUrl, document.baseURI).href, raw));
      if (!root.isConnected) return;
      if (edits !== editAtStart) throw Error('欄位已手動編輯。');
      if (storage.getItem(damageDraftKey) !== raw || storage.getItem(damageDraftJournalKey)) throw Error('工作草稿已變更，請重新引用。');
      if (!next) throw Error('無法取得有效的兩項屬性。');
      base = next;
      fields.forEach(fillField);
      status.textContent = save(base) ? '已帶入配裝的兩項屬性。' : '已帶入配裝屬性，目前無法儲存。';
    } catch (error) {
      if (root.isConnected) status.textContent = (error instanceof Error ? error.message : '引用未完成。') + ' 已保留目前數值。';
    } finally {
      button.disabled = false;
    }
  });
}
