export interface SheetInputReference {
  simulatorCells: string;
  catalogId: string;
}

export interface SheetChoiceCatalog<TOption = { value: string | number }> {
  id: string;
  options: readonly TOption[];
}

function columnNumber(letters: string): number {
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function parseCell(address: string): { column: number; row: number } | null {
  const match = address.match(/^([A-Z]+)([0-9]+)$/);
  return match ? { column: columnNumber(match[1]), row: Number(match[2]) } : null;
}

export function rangeContainsCell(range: string, cell: string): boolean {
  if (!range.includes(':')) return range === cell;
  const [start, end] = range.split(':');
  const first = parseCell(start);
  const last = parseCell(end);
  const target = parseCell(cell);
  return !!first && !!last && !!target
    && target.column >= first.column && target.column <= last.column
    && target.row >= first.row && target.row <= last.row;
}

export function findValidationCatalog<
  TInput extends SheetInputReference,
  TCatalog extends SheetChoiceCatalog,
>(inputs: readonly TInput[], catalogs: readonly TCatalog[], cell: string): TCatalog | undefined {
  const input = inputs.find(entry => entry.simulatorCells.split(/\s+/).some(range => rangeContainsCell(range, cell)));
  return input ? catalogs.find(catalog => catalog.id === input.catalogId) : undefined;
}
