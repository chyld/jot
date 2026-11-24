// @vitest-environment jsdom
// Type 7 (component): style buttons — left bar link, /buttons screen, editor toolbar
// group (position, tooltips, stamping, single undo, in-use underline, mixed selections,
// read-only disabled), and live sync between /buttons and the editor without reload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultStyleButtons, type ButtonSlot, type StyleButton } from '../../src/shared/buttons';
import { PALETTE } from '../../src/shared/palette';
import { Sidebar } from '../../src/client/components/Sidebar';
import { DataProvider } from '../../src/client/data';
import { applyStyle } from '../../src/client/editor/stamp';
import { Toolbar } from '../../src/client/editor/Toolbar';
import { ButtonsScreen } from '../../src/client/screens/ButtonsScreen';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS, makeEditor, marksOf, select, style as makeStyle, STYLES } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Toolbar style buttons', () => {
  function renderBar(buttons?: StyleButton[], opts: { content?: unknown; readOnly?: boolean; styles?: typeof STYLES } = {}) {
    const editor = makeEditor(opts.content ?? '<p>Hello world</p>');
    render(
      <Toolbar
        editor={editor}
        styles={opts.styles ?? STYLES}
        fonts={FONTS}
        buttons={buttons}
        readOnly={opts.readOnly}
        onSaveSelectionAsStyle={vi.fn()}
        onManageStyles={vi.fn()}
        onBrowseFonts={vi.fn()}
        onPickImage={vi.fn()}
      />,
    );
    return { editor, bar: screen.getByRole('toolbar', { name: 'Formatting' }) };
  }

  it('is absent (with its separator) when no buttons are bound and shown', () => {
    const none = defaultStyleButtons();
    none[0] = { slot: 1, styleId: STYLES[1].id, hidden: true }; // hidden
    const { bar } = renderBar(none);
    expect(within(bar).queryByRole('group', { name: 'Style buttons' })).toBeNull();
  });

  it('sits immediately right of Link, shows only bound+shown buttons in slot order, with exact tooltips and palette colours', () => {
    const btns = defaultStyleButtons();
    btns[4] = { slot: 5, styleId: STYLES[2].id, hidden: false }; // Key Term
    btns[0] = { slot: 1, styleId: STYLES[0].id, hidden: false }; // Body
    btns[2] = { slot: 3, styleId: STYLES[1].id, hidden: true }; // hidden Quote
    btns[7] = { slot: 8, styleId: STYLES[1].id, hidden: false }; // Quote
    // Pass unsorted to confirm slot-order rendering.
    const { bar } = renderBar([...btns].reverse());

    const labels = [...bar.querySelectorAll('button[aria-label], input[aria-label]')].map((el) => el.getAttribute('aria-label'));
    const linkIdx = labels.indexOf('Link');
    const headingIdx = labels.indexOf('Heading');
    expect(labels.slice(linkIdx + 1, headingIdx)).toEqual([
      'Style button 1: Body',
      'Style button 5: Key Term',
      'Style button 8: Quote',
    ]);

    const b1 = within(bar).getByRole('button', { name: 'Style button 1: Body' });
    const b5 = within(bar).getByRole('button', { name: 'Style button 5: Key Term' });
    const b8 = within(bar).getByRole('button', { name: 'Style button 8: Quote' });
    // Style buttons replace the native title with Jot's preview tooltip; other buttons keep title.
    expect(b1.getAttribute('title')).toBeNull();
    expect(b5.getAttribute('title')).toBeNull();
    expect(b8.getAttribute('title')).toBeNull();
    expect(b1.getAttribute('aria-describedby')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('title')).toBe('Bold');
    expect(within(bar).getByRole('button', { name: 'Link' }).getAttribute('title')).toBe('Link');
    expect(within(bar).getByRole('button', { name: 'Heading' }).getAttribute('title')).toBe('Heading');
    // Must not use .tb-btn (which paints a filled pressed background).
    expect(b1.className).not.toContain('tb-btn');
    expect((b1.querySelector('.style-chip') as HTMLElement).style.getPropertyValue('--chip-color')).toBe(PALETTE[0].text);
    expect((b5.querySelector('.style-chip') as HTMLElement).style.getPropertyValue('--chip-color')).toBe(PALETTE[4].text);
    expect((b8.querySelector('.style-chip') as HTMLElement).style.getPropertyValue('--chip-color')).toBe(PALETTE[7].text);
  });

  it('hovering shows a preview tooltip after ~150 ms with style name and styled Sample, and mouse leave hides it immediately', () => {
    vi.useFakeTimers();
    try {
      const bigTitle = makeStyle({ name: 'Big Title', fontFamily: 'Playfair Display', size: 40, bold: true, underline: true, strike: true });
      const styles = [...STYLES, bigTitle];
      const btns = defaultStyleButtons();
      btns[0] = { slot: 1, styleId: STYLES[1].id, hidden: false }; // Quote
      btns[1] = { slot: 2, styleId: STYLES[2].id, hidden: false }; // Key Term
      btns[2] = { slot: 3, styleId: bigTitle.id, hidden: false }; // 40px Title (size capped at 30px)
      const { bar } = renderBar(btns, { styles });

      const b1 = within(bar).getByRole('button', { name: 'Style button 1: Quote' });
      const b2 = within(bar).getByRole('button', { name: 'Style button 2: Key Term' });
      const b3 = within(bar).getByRole('button', { name: 'Style button 3: Big Title' });

      // Sweeping across buttons without dwelling does not flicker a tooltip.
      fireEvent.mouseEnter(b1);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.mouseLeave(b1);
      fireEvent.mouseEnter(b2);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.mouseLeave(b2);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();

      // Hovering Quote past the delay shows its name and styled Sample.
      fireEvent.mouseEnter(b1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      let tip = screen.getByRole('tooltip');
      expect(within(tip).getByText('Quote')).toBeTruthy();
      let sample = within(tip).getByText('Sample') as HTMLElement;
      expect(sample.style.fontFamily).toContain('Lora');
      expect(sample.style.fontSize).toBe('20px');
      expect(sample.style.fontStyle).toBe('italic');
      expect(sample.style.color).toBe('rgb(143, 42, 244)');

      // Mouse leave hides immediately.
      fireEvent.mouseLeave(b1);
      expect(screen.queryByRole('tooltip')).toBeNull();

      // Hovering Key Term shows bold + Sunflower highlight.
      fireEvent.mouseEnter(b2);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      tip = screen.getByRole('tooltip');
      expect(within(tip).getByText('Key Term')).toBeTruthy();
      sample = within(tip).getByText('Sample') as HTMLElement;
      expect(sample.style.fontWeight).toBe('700');
      expect(sample.style.backgroundColor).toBe('rgb(255, 229, 143)');
      fireEvent.mouseLeave(b2);

      // Hovering a 40px style caps the preview size at 30px, matching stylePreviewCss.
      fireEvent.mouseEnter(b3);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      tip = screen.getByRole('tooltip');
      expect(within(tip).getByText('Big Title')).toBeTruthy();
      sample = within(tip).getByText('Sample') as HTMLElement;
      expect(sample.style.fontFamily).toContain('Playfair Display');
      expect(sample.style.fontSize).toBe('30px');
      expect(sample.style.fontWeight).toBe('700');
      expect(sample.style.textDecoration).toContain('underline');
      expect(sample.style.textDecoration).toContain('line-through');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard focus shows the preview tooltip and blur, Escape, or click hides it', () => {
    vi.useFakeTimers();
    try {
      const btns = defaultStyleButtons();
      btns[0] = { slot: 1, styleId: STYLES[1].id, hidden: false }; // Quote
      const { editor, bar } = renderBar(btns, { content: '<p>hello</p>' });
      const b1 = within(bar).getByRole('button', { name: 'Style button 1: Quote' });

      // Focus shows tooltip; blur hides it.
      fireEvent.focus(b1);
      const tip = screen.getByRole('tooltip');
      expect(within(tip).getByText('Quote')).toBeTruthy();
      expect((within(tip).getByText('Sample') as HTMLElement).style.fontFamily).toContain('Lora');
      fireEvent.blur(b1);
      expect(screen.queryByRole('tooltip')).toBeNull();

      // Focus then Escape hides it.
      fireEvent.focus(b1);
      expect(screen.getByRole('tooltip')).toBeTruthy();
      fireEvent.keyDown(b1, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).toBeNull();

      // Hover (button not focused) then document Escape hides it.
      fireEvent.mouseEnter(b1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByRole('tooltip')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.mouseLeave(b1);

      // Hover then click hides tooltip and stamps the style.
      select(editor, 'hello');
      fireEvent.mouseEnter(b1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByRole('tooltip')).toBeTruthy();
      fireEvent.click(b1);
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(marksOf(editor, 'hello').italic).toBeDefined();

      // Touch tap does not leave a tooltip open via synthetic mouseenter.
      fireEvent.touchStart(b1);
      fireEvent.mouseEnter(b1);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking stamps the style in one undo step, underlines matching buttons, and shows no underline on a mixed selection', async () => {
    const btns = defaultStyleButtons();
    btns[0] = { slot: 1, styleId: STYLES[1].id, hidden: false }; // Quote
    btns[1] = { slot: 2, styleId: STYLES[2].id, hidden: false }; // Key Term
    btns[5] = { slot: 6, styleId: STYLES[1].id, hidden: false }; // Quote (duplicate binding)
    const { editor, bar } = renderBar(btns, { content: '<p>alpha beta</p>' });

    const b1 = within(bar).getByRole('button', { name: 'Style button 1: Quote' });
    const b2 = within(bar).getByRole('button', { name: 'Style button 2: Key Term' });
    const b6 = within(bar).getByRole('button', { name: 'Style button 6: Quote' });
    expect(b1.className).not.toContain('is-in-use');

    // Stamp Quote onto "alpha".
    select(editor, 'alpha');
    await userEvent.click(b1);
    const marks = marksOf(editor, 'alpha');
    expect(marks.textStyle).toMatchObject({ fontFamily: '"Lora"', fontSize: '20px', color: '#8F2AF4' });
    expect(marks.italic).toBeDefined();
    // Both buttons bound to Quote are underlined; Key Term is not.
    expect(b1.className).toContain('is-in-use');
    expect(b1.getAttribute('aria-pressed')).toBe('true');
    expect(b6.className).toContain('is-in-use');
    expect(b6.getAttribute('aria-pressed')).toBe('true');
    expect(b2.className).not.toContain('is-in-use');

    // Stamp Key Term onto "beta".
    select(editor, 'beta');
    await userEvent.click(b2);
    expect(b2.className).toContain('is-in-use');
    expect(b1.className).not.toContain('is-in-use');

    // Mixed selection spanning Quote ("alpha") and Key Term ("beta"): NO button underlined.
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    });
    expect(b1.className).not.toContain('is-in-use');
    expect(b2.className).not.toContain('is-in-use');
    expect(b6.className).not.toContain('is-in-use');

    // Single undo step reverts the Key Term stamp on "beta".
    await userEvent.click(within(bar).getByRole('button', { name: 'Undo' }));
    expect(marksOf(editor, 'beta').bold).toBeUndefined();
    expect(marksOf(editor, 'beta').highlight).toBeUndefined();
    expect(marksOf(editor, 'alpha').italic).toBeDefined();
  });

  it('mixed selection of styled text and plain text underlines no button', () => {
    const btns = defaultStyleButtons();
    btns[0] = { slot: 1, styleId: STYLES[1].id, hidden: false }; // Quote
    const { editor, bar } = renderBar(btns, { content: '<p>styled plain</p>' });
    act(() => {
      select(editor, 'styled');
      applyStyle(editor, STYLES[1]);
    });
    const b1 = within(bar).getByRole('button', { name: 'Style button 1: Quote' });
    expect(b1.className).toContain('is-in-use');

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    });
    expect(b1.className).not.toContain('is-in-use');
  });

  it('disables style buttons on read-only notes and shows no tooltip', () => {
    vi.useFakeTimers();
    try {
      const btns = defaultStyleButtons();
      btns[0] = { slot: 1, styleId: STYLES[1].id, hidden: false };
      const { bar } = renderBar(btns, { readOnly: true });
      const b1 = within(bar).getByRole('button', { name: 'Style button 1: Quote' }) as HTMLButtonElement;
      expect(b1.disabled).toBe(true);
      fireEvent.mouseEnter(b1);
      fireEvent.focus(b1);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('/buttons page, left bar and live sync', () => {
  let buttons: StyleButton[];
  const calls: Array<{ url: string; method: string; body: any }> = [];

  beforeEach(() => {
    calls.length = 0;
    buttons = defaultStyleButtons();
    buttons[0] = { slot: 1, styleId: STYLES[0].id, hidden: false }; // Body
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ url, method, body });
        if (url === '/api/fonts') return json({ fonts: FONTS });
        if (url === '/api/styles') return json({ styles: STYLES });
        if (url === '/api/buttons' && method === 'GET') return json({ buttons });
        if (url.startsWith('/api/buttons/') && method === 'PATCH') {
          const slot = Number(url.split('/').pop()) as ButtonSlot;
          const cur = buttons.find((b) => b.slot === slot)!;
          const updated: StyleButton = {
            slot,
            styleId: body.styleId !== undefined ? body.styleId : cur.styleId,
            hidden: body.hidden !== undefined ? body.hidden : cur.hidden,
          };
          buttons = buttons.map((b) => (b.slot === slot ? updated : b));
          return json({ button: updated });
        }
        if (url === '/api/inbox') return json({ notes: [] });
        if (url === '/api/sections') return json({ sections: [{ id: 'default', name: 'Default', colour: 'olive', noteCount: 1, trashCount: 0 }] });
        if (url === '/api/notes/n1') {
          return json({
            note: {
              id: 'n1',
              title: 'Demo',
              preview: '',
              tags: [],
              createdAt: '2026-11-19T10:00:00Z',
              updatedAt: '2026-11-19T10:00:00Z',
              deletedAt: null,
              readOnly: false,
              inbox: false,
              botName: null,
              section: 'default',
              content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
            },
          });
        }
        if (url.startsWith('/api/notes?')) return json({ notes: [] });
        return json({ error: 'unexpected' }, 500);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const inApp = (ui: React.ReactNode) =>
    render(
      <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
        {ui}
      </DataProvider>,
    );

  it('left bar places Buttons between Styles and Account and marks it active on /buttons', async () => {
    inApp(<Sidebar path="/buttons" />);
    const links = screen.getAllByRole('link');
    const labels = links.map((a) => a.getAttribute('aria-label'));
    expect(labels.indexOf('Buttons')).toBe(labels.indexOf('Styles') + 1);
    expect(labels.indexOf('Account')).toBe(labels.indexOf('Buttons') + 1);
    const btnLink = screen.getByRole('link', { name: 'Buttons' });
    expect(btnLink.getAttribute('href')).toBe('/buttons');
    expect(btnLink.getAttribute('aria-current')).toBe('page');
    expect(btnLink.className).toContain('is-active');
  });

  it('renders ten fixed places in order 1–10 with no delete control, and saves bind, swap, clear and hide immediately', async () => {
    inApp(<ButtonsScreen />);
    expect(screen.getByRole('heading', { name: 'Buttons', level: 1 })).toBeTruthy();
    const grid = screen.getByTestId('buttons-grid');
    const slots = within(grid).getAllByRole('article');
    expect(slots.map((s) => s.getAttribute('aria-label'))).toEqual(Array.from({ length: 10 }, (_, i) => `Button ${i + 1}`));
    // No delete or trash control anywhere on the page.
    expect(within(grid).queryByRole('button', { name: /delete|trash|remove/i })).toBeNull();

    // Wait for initial data load: slot 1 is bound to Body, slot 2 is empty with outline chip and "Bind a style".
    await waitFor(() => expect(within(slots[0]).getByRole('button', { name: 'Button 1 style: Body' })).toBeTruthy());
    expect(slots[1].className).toContain('is-empty');
    expect(slots[1].querySelector('.style-chip')!.className).toContain('is-empty');
    expect(within(slots[1]).getByRole('button', { name: 'Bind a style to button 2' }).textContent).toContain('Bind a style');

    // Bind Quote to slot 2: menu previews Quote in Lora italic Violet and includes "No style".
    await userEvent.click(within(slots[1]).getByRole('button', { name: 'Bind a style to button 2' }));
    const menu = screen.getByRole('menu', { name: 'Style for button 2' });
    const quoteItem = within(menu).getByRole('menuitem', { name: 'Quote' });
    const preview = within(quoteItem).getByText('Quote') as HTMLElement;
    expect(preview.style.fontFamily).toContain('Lora');
    expect(preview.style.fontStyle).toBe('italic');
    expect(within(menu).getByRole('menuitem', { name: 'No style' })).toBeTruthy();

    await userEvent.click(quoteItem);
    await waitFor(() => expect(within(slots[1]).getByRole('button', { name: 'Button 2 style: Quote' })).toBeTruthy());
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toEqual({ url: '/api/buttons/2', method: 'PATCH', body: { styleId: STYLES[1].id } });

    // Hide slot 2: card fades, eye toggle marks pressed, binding stays.
    await userEvent.click(within(slots[1]).getByRole('button', { name: 'Hide button 2' }));
    await waitFor(() => expect(slots[1].className).toContain('is-hidden'));
    expect(within(slots[1]).getByRole('button', { name: 'Show button 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(slots[1]).getByRole('button', { name: 'Button 2 style: Quote' })).toBeTruthy();

    // Clear slot 1 back to "No style".
    await userEvent.click(within(slots[0]).getByRole('button', { name: 'Button 1 style: Body' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Style for button 1' })).getByRole('menuitem', { name: 'No style' }));
    await waitFor(() => expect(within(slots[0]).getByRole('button', { name: 'Bind a style to button 1' })).toBeTruthy());
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toEqual({ url: '/api/buttons/1', method: 'PATCH', body: { styleId: null } });
  });

  it('changes made on /buttons show in the editor toolbar without a page reload', async () => {
    inApp(
      <>
        <ButtonsScreen />
        <NoteEditor noteId="n1" onTrashed={() => {}} />
      </>,
    );
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' });
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Style button 1: Body' })).toBeTruthy());
    expect(within(bar).queryByRole('button', { name: /Style button 2/ })).toBeNull();

    // Bind Quote to button 2 on /buttons -> appears immediately in the editor toolbar.
    await userEvent.click(screen.getByRole('button', { name: 'Bind a style to button 2' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Style for button 2' })).getByRole('menuitem', { name: 'Quote' }));
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Style button 2: Quote' })).toBeTruthy());

    // Hide button 1 -> disappears immediately from the editor toolbar.
    await userEvent.click(screen.getByRole('button', { name: 'Hide button 1' }));
    await waitFor(() => expect(within(bar).queryByRole('button', { name: /Style button 1/ })).toBeNull());
  });
});
