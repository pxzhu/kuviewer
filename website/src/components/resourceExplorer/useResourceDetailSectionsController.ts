import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultOpenDetailSections,
  detailKeyboardSections,
  type DetailSectionId,
} from './resourceDetailTypes';
import { resolveResourceDetailShortcut } from './resourceDetailShortcut';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

export function useResourceDetailSectionsController({
  focusRequest,
  resourceId,
}: {
  focusRequest: number;
  resourceId: string;
}) {
  const [activeDetailSectionId, setActiveDetailSectionId] = useState<DetailSectionId>('metadata');
  const [openSections, setOpenSections] = useState<Set<DetailSectionId>>(() => new Set(defaultOpenDetailSections));
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailPanelActiveRef = useRef(false);
  const detailSectionRefs = useRef<Partial<Record<DetailSectionId, HTMLElement | null>>>({});

  const isSectionOpen = useCallback((id: DetailSectionId) => openSections.has(id), [openSections]);
  const toggleSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const openSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);
  const focusDetailSection = useCallback((id: DetailSectionId) => {
    setActiveDetailSectionId(id);
    openSection(id);
    window.requestAnimationFrame(() => {
      const section = detailSectionRefs.current[id];
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section?.focus({ preventScroll: true });
    });
  }, [openSection]);
  const moveDetailSection = useCallback((offset: number) => {
    const currentIndex = detailKeyboardSections.indexOf(activeDetailSectionId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + offset + detailKeyboardSections.length) % detailKeyboardSections.length : 0;
    focusDetailSection(detailKeyboardSections[nextIndex]);
  }, [activeDetailSectionId, focusDetailSection]);
  const handleExpandAllDetailSections = useCallback(() => {
    setOpenSections(new Set(detailKeyboardSections));
  }, []);
  const handleCollapseAllDetailSections = useCallback(() => {
    setOpenSections(new Set());
  }, []);
  const handleResetDetailSections = useCallback(() => {
    setOpenSections(new Set(defaultOpenDetailSections));
  }, []);
  const setDetailSectionRef = useCallback((id: DetailSectionId) => (node: HTMLElement | null) => {
    detailSectionRefs.current[id] = node;
  }, []);
  const activateDetailPanel = useCallback(() => {
    detailPanelActiveRef.current = true;
  }, []);

  useEffect(() => {
    setActiveDetailSectionId('metadata');
    setOpenSections(new Set(defaultOpenDetailSections));
  }, [resourceId]);

  useEffect(() => {
    if (focusRequest <= 0) {
      return;
    }
    activateDetailPanel();
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.focus({ preventScroll: false });
    });
  }, [activateDetailPanel, focusRequest]);

  const handleDetailShortcut = useCallback((event: globalThis.KeyboardEvent) => {
    const eventPath = event.composedPath();
    const editable = Boolean(
      detailPanelRef.current?.querySelector('input:focus, select:focus, textarea:focus, button:focus, [contenteditable="true"]:focus'),
    ) || isEditableTarget(event.target) || isEditableTarget(document.activeElement) || eventPath.some((target) => isEditableTarget(target));
    const shortcut = resolveResourceDetailShortcut({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      editable,
      key: event.key,
      metaKey: event.metaKey,
    });
    if (!shortcut) {
      return;
    }

    event.preventDefault();
    if (shortcut.type === 'move') {
      moveDetailSection(shortcut.offset);
    } else if (shortcut.type === 'toggle') {
      toggleSection(activeDetailSectionId);
    } else if (shortcut.type === 'expand-all') {
      handleExpandAllDetailSections();
    } else if (shortcut.type === 'collapse-all') {
      handleCollapseAllDetailSections();
    } else if (shortcut.type === 'reset') {
      handleResetDetailSections();
    } else {
      focusDetailSection(shortcut.sectionId);
    }
  }, [activeDetailSectionId, focusDetailSection, handleCollapseAllDetailSections, handleExpandAllDetailSections, handleResetDetailSections, moveDetailSection, toggleSection]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentFocusIn = (event: FocusEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (detailPanelActiveRef.current) {
        handleDetailShortcut(event);
      }
    };
    document.addEventListener('mousedown', handleDocumentPointerDown, true);
    document.addEventListener('touchstart', handleDocumentPointerDown, true);
    document.addEventListener('focusin', handleDocumentFocusIn);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown, true);
      document.removeEventListener('touchstart', handleDocumentPointerDown, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [handleDetailShortcut]);

  return {
    activateDetailPanel,
    activeDetailSectionId,
    detailPanelRef,
    focusDetailSection,
    handleCollapseAllDetailSections,
    handleExpandAllDetailSections,
    handleResetDetailSections,
    isSectionOpen,
    openSection,
    openSections,
    setActiveDetailSectionId,
    setDetailSectionRef,
    toggleSection,
  };
}
