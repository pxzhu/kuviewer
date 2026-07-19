import { detailKeyboardSections, type DetailSectionId } from './resourceDetailTypes.ts';

interface ResourceDetailShortcutInput {
  altKey?: boolean;
  ctrlKey?: boolean;
  editable?: boolean;
  key: string;
  metaKey?: boolean;
}

export type ResourceDetailShortcut =
  | { type: 'move'; offset: -1 | 1 }
  | { type: 'toggle' }
  | { type: 'expand-all' }
  | { type: 'collapse-all' }
  | { type: 'reset' }
  | { type: 'focus'; sectionId: DetailSectionId };

export function resolveResourceDetailShortcut({
  altKey = false,
  ctrlKey = false,
  editable = false,
  key,
  metaKey = false,
}: ResourceDetailShortcutInput): ResourceDetailShortcut | null {
  if (altKey || ctrlKey || metaKey || editable) {
    return null;
  }

  const normalizedKey = key.toLowerCase();
  if (normalizedKey === 'j') {
    return { type: 'move', offset: 1 };
  }
  if (normalizedKey === 'k') {
    return { type: 'move', offset: -1 };
  }
  if (normalizedKey === 'o') {
    return { type: 'toggle' };
  }
  if (normalizedKey === 'e') {
    return { type: 'expand-all' };
  }
  if (normalizedKey === 'c') {
    return { type: 'collapse-all' };
  }
  if (normalizedKey === 'r') {
    return { type: 'reset' };
  }
  if (/^[1-9]$/.test(normalizedKey)) {
    const sectionId = detailKeyboardSections[Number(normalizedKey) - 1];
    return sectionId ? { type: 'focus', sectionId } : null;
  }
  return null;
}
