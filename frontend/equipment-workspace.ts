import { escapeHtml as h } from './data.ts';
import { icon } from './icons.ts';

export const statusLabels = { empty: '未設定', partial: '部分設定', complete: '全部完成' };

function setAttribute(button: HTMLButtonElement, name: string, value: string) {
  if (button.getAttribute(name) !== value) button.setAttribute(name, value);
}

export function updateSlotState(button: HTMLButtonElement, progress: keyof typeof statusLabels, pressed: boolean, description: string) {
  button.classList.toggle('configured', progress === 'complete');
  button.classList.toggle('selected', pressed);
  setAttribute(button, 'data-configuration', progress);
  setAttribute(button, 'aria-pressed', String(pressed));
  setAttribute(button, 'aria-label', description);
  setAttribute(button, 'title', description);
}

export function renderSlotContent(glyph: string | null, label: string, item: string, progress: keyof typeof statusLabels, iceSet?: number) {
  const status = progress === 'complete' ? '<i aria-hidden="true"></i>' : '';
  const itemLabel = item ? `<span class="gear-slot-item-name">${h(item)}</span>` : '';
  const setIndex = iceSet ? `<b class="slot-set-index" aria-hidden="true">${iceSet}</b>` : '';
  return `${glyph ? icon(glyph) : ''}<span class="gear-slot-label">${h(label)}</span>${itemLabel}${status}${setIndex}`;
}

export function renderEquipmentHeading(group: string, name: string, glyph: string, switches: string, color: string, beast = false) {
  return `<div class="inspector-title${beast ? ' beast-inspector-title' : ''}"${color ? ` style="--group-color:${h(color)}"` : ''}>${icon(glyph)}<div class="inspector-title-copy"><small>${h(group)}</small><h2>${h(name)}</h2></div>${switches}<button class="inspector-close" type="button" aria-label="關閉部位設定">×</button></div>`;
}

export function createEditorSection(parent: HTMLElement, label: string, key: string, open: boolean) {
  const details = document.createElement('details');
  details.className = 'editor-section';
  details.dataset.disclosureKey = key;
  details.open = open;
  const heading = document.createElement('summary');
  heading.textContent = label;
  const body = document.createElement('div');
  body.className = 'editor-section-body';
  details.append(heading, body);
  parent.append(details);
  return body;
}

export function attributeValueGrid(parent: HTMLElement, extraClass = '') {
  const grid = document.createElement('div');
  grid.className = 'attribute-value-grid';
  if (extraClass) grid.classList.add(extraClass);
  parent.append(grid);
  return grid;
}
