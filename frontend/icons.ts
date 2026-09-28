const paths: Record<string, string> = {
  weapon: 'M6 25 25 6l2 2-19 19M5 20l7 7M3 29l4-4',
  hair: 'M7 23V13a9 9 0 0 1 18 0v10l-5-5-4-8-4 8z',
  upper: 'm10 5-7 5 4 7 4-2v13h12V15l4 2 4-7-7-5-7 4z',
  lower: 'M9 5h15l2 23h-8l-2-14-2 14H6z',
  gloves: 'M9 28 5 17l3-2 4 4V7h3v9-12h3v12-10h3v11-8h3v15l-4 5z',
  shoes: 'M11 5h12v16l5 4v4H5v-6l6-3z',
  ring: 'M25 20a9 9 0 1 1-18 0 9 9 0 0 1 18 0M11 7l5-4 5 4-5 6z',
  necklace: 'M6 5c0 15 20 15 20 0M16 20l5 5-5 5-5-5z',
  mirror: 'M7 4h18v24H7zM11 9h10M11 14h10M11 19h6',
};
export function icon(name: string): string {
  const aliases: Record<string, string> = { '連身時裝': 'upper', '頭髮': 'hair', '頭飾': 'hair', '上衣': 'upper', '下衣': 'lower', '強/排褲': 'lower', '手套': 'gloves', '鞋子': 'shoes', '冰武': 'weapon', '武器': 'weapon', '武飾': 'weapon', '戒指': 'ring', '戒指A': 'ring', '戒指B': 'ring', '指環 1': 'ring', '指環 2': 'ring', '項鍊': 'necklace', '迷鏡': 'mirror' };
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="${paths[aliases[name] ?? name] ?? 'm16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4z'}"/></svg>`;
}
export const silhouette = `<svg class="silhouette" viewBox="0 0 180 360" aria-hidden="true"><defs><linearGradient id="figure" x2="0" y2="1"><stop stop-color="#71849a" stop-opacity=".27"/><stop offset="1" stop-color="#71849a" stop-opacity=".05"/></linearGradient></defs><ellipse cx="90" cy="335" rx="65" ry="12" fill="#13171d"/><path d="M69 35q21-25 42 0l-2 33-10 11 9 15 28 14 15 94-12 5-20-66-7 64 13 111-19 6-17-93-13 93-19-6 12-112-8-63-23 65-12-5 20-94 29-15 7-14-12-12z" fill="url(#figure)" stroke="#8796aa" stroke-opacity=".3"/><circle cx="90" cy="161" r="75" fill="none" stroke="#a4b7d5" stroke-opacity=".08"/><path d="M90 3v337M10 162h160" stroke="#a4b7d5" stroke-opacity=".05"/></svg>`;
