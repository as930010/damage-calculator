/** Prevent number inputs from accepting scientific notation (for example, 1e3). */
export function preventScientificNotation(input: HTMLInputElement): void {
  input.inputMode = 'decimal';
  let lastValidValue = input.value;

  input.addEventListener('keydown', event => {
    if (event.key.toLocaleLowerCase() === 'e') event.preventDefault();
  });
  input.addEventListener('beforeinput', event => {
    const data = (event as InputEvent).data;
    if (data?.toLocaleLowerCase().includes('e')) event.preventDefault();
  });
  input.addEventListener('paste', event => {
    const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? '';
    if (/[eE]/.test(text)) event.preventDefault();
  });
  input.addEventListener('input', () => {
    if (/[eE]/.test(input.value)) {
      input.value = lastValidValue;
      return;
    }
    lastValidValue = input.value;
  });
}

/** Remove binary floating-point display tails without changing useful decimal precision. */
export function canonicalizeNumber(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
}
