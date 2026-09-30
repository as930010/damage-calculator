import type { SelectedMember } from "./types.ts";

export interface UniquenessResult {
  activeMembers: SelectedMember[];
  /** Class IDs are returned for a duplicate warning; no member attribution is produced. */
  ignoredClassIds: string[];
}

/**
 * Mirrors the workbook's first-occurrence count rule within the supplied arena scope:
 * a repeated class contributes once, and a uniqueness group contributes once total.
 */
export function applyUniquenessScope(
  members: SelectedMember[],
  uniqueClassCodes: string[] = [],
): UniquenessResult {
  const uniqueCodeSet = new Set(uniqueClassCodes);
  const seenClassIds = new Set<string>();
  const seenClassCodes = new Set<string>();
  const seenGroups = new Set<string>();
  const activeMembers: SelectedMember[] = [];
  const ignoredClassIds: string[] = [];

  for (const member of members) {
    const repeatedClass = seenClassIds.has(member.classId) || seenClassCodes.has(member.classCode);
    const alreadyCoveredGroup = member.uniquenessGroup !== undefined &&
      seenGroups.has(member.uniquenessGroup);
    const alreadyCoveredUniqueCode = uniqueCodeSet.has(member.classCode) &&
      seenGroups.has("green-control");

    if (repeatedClass || alreadyCoveredGroup || alreadyCoveredUniqueCode) {
      ignoredClassIds.push(member.classId);
      continue;
    }

    activeMembers.push(member);
    seenClassIds.add(member.classId);
    seenClassCodes.add(member.classCode);
    if (member.uniquenessGroup) seenGroups.add(member.uniquenessGroup);
    if (uniqueCodeSet.has(member.classCode)) seenGroups.add("green-control");
  }

  return { activeMembers, ignoredClassIds };
}
