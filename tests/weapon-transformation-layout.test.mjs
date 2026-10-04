import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../frontend/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf8');

test('武器變換屬性和數值共用雙欄網格', () => {
  assert.ok(main.includes("attributeValueGrid(transform, 'weapon-transformation-grid')"));
  assert.ok(main.includes('field(transformationGrid,'));
  assert.ok(main.includes('numeric(transformationGrid,'));
  assert.match(styles, /\.attribute-value-grid\{display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
