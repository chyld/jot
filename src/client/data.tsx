// The logged-in user's fonts and styles, shared by every screen, plus a counter
// screens bump when the notes list should reload.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Style } from '../shared/styles';
import type { Font, User } from '../shared/types';
import { api } from './api';
import { clearAllUnsaved, resumeUnsaved } from './unsaved';

interface Data {
  user: User;
  fonts: Font[];
  styles: Style[];
  reloadFonts: () => Promise<void>;
  reloadStyles: () => Promise<void>;
  notesVersion: number;
  bumpNotes: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<Data | null>(null);

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData outside DataProvider');
  return d;
}

/** Keeps a <link> to the user's private @font-face stylesheet in the page. */
function useFontStylesheet(version: number) {
  useEffect(() => {
    let link = document.head.querySelector<HTMLLinkElement>('link[data-jot-fonts]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.jotFonts = '';
      document.head.appendChild(link);
    }
    link.href = `/api/fonts.css?v=${version}`;
  }, [version]);
  // Logging out removes the user's fonts from the page.
  useEffect(() => () => document.head.querySelector('link[data-jot-fonts]')?.remove(), []);
}

export function DataProvider(props: { user: User; onLogout: () => void; children: ReactNode }) {
  resumeUnsaved(props.user.id);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [fontsVersion, setFontsVersion] = useState(1);
  const [notesVersion, setNotesVersion] = useState(1);

  const reloadFonts = useCallback(async () => {
    setFonts((await api.fonts()).fonts);
    setFontsVersion((v) => v + 1);
  }, []);
  const reloadStyles = useCallback(async () => setStyles((await api.styles()).styles), []);
  useEffect(() => {
    void reloadFonts();
    void reloadStyles();
  }, [reloadFonts, reloadStyles]);
  useFontStylesheet(fontsVersion);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Unsaved edits kept in this browser belong to this user only.
      clearAllUnsaved(props.user.id);
      props.onLogout();
    }
  }, [props]);

  return (
    <Ctx.Provider
      value={{
        user: props.user,
        fonts,
        styles,
        reloadFonts,
        reloadStyles,
        notesVersion,
        bumpNotes: () => setNotesVersion((v) => v + 1),
        logout,
      }}
    >
      {props.children}
    </Ctx.Provider>
  );
}
