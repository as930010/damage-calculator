/** Display terminology only; stored choices and lookup identifiers remain intact. */
export function attributeLabel(label: string): string {
  return label.replaceAll('雙攻', '攻擊力');
}
