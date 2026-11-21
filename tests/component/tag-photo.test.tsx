// @vitest-environment jsdom
// Type 7 (component): the tag input and the photo controls.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagInput } from '../../src/client/components/TagInput';
import { NoteCard } from '../../src/client/components/NoteCard';
import { PhotoControls } from '../../src/client/editor/PhotoControls';
import { CORNERS, cornerDragWidth, photoResizeEvents } from '../../src/client/editor/photo';
import { makeEditor } from './setup';

describe('TagInput', () => {
  function setup(tags: string[] = ['demo'], onAdd = vi.fn<(tag: string) => Promise<string | null>>(async () => null)) {
    const onRemove = vi.fn();
    render(<TagInput tags={tags} onAdd={onAdd} onRemove={onRemove} />);
    return { onAdd, onRemove, input: screen.getByRole('textbox', { name: 'Add tag' }) };
  }

  describe('Tab', () => {
    function withNeighbours(onAdd = vi.fn<(tag: string) => Promise<string | null>>(async () => null)) {
      render(
        <>
          <button>before</button>
          <TagInput tags={[]} onAdd={onAdd} onRemove={vi.fn()} />
          <button>after</button>
        </>,
      );
      return { onAdd, input: screen.getByRole('textbox', { name: 'Add tag' }) as HTMLInputElement };
    }

    it('adds the tag like Enter (lowercased), clears the box and keeps the cursor in it', async () => {
      const { onAdd, input } = withNeighbours();
      await userEvent.click(input);
      await userEvent.keyboard('Styles{Tab}');
      expect(onAdd).toHaveBeenCalledWith('styles');
      expect(input.value).toBe('');
      expect(document.activeElement).toBe(input);
    });

    it('takes three tags separated by Tab', async () => {
      const { onAdd, input } = withNeighbours();
      await userEvent.click(input);
      await userEvent.keyboard('one{Tab}Two{Tab}three{Tab}');
      expect(onAdd.mock.calls.map((c) => c[0])).toEqual(['one', 'two', 'three']);
      expect(input.value).toBe('');
      expect(document.activeElement).toBe(input);
    });

    it('keeps up with fast typing while the server is slow: each tag is added in order and the box is free at once', async () => {
      const resolvers: Array<() => void> = [];
      const onAdd = vi.fn<(tag: string) => Promise<string | null>>(() => new Promise((r) => resolvers.push(() => r(null))));
      const { input } = withNeighbours(onAdd);
      await userEvent.click(input);
      await userEvent.keyboard('first{Tab}');
      expect(input.value).toBe('');
      await userEvent.keyboard('second{Tab}third{Enter}');
      expect(input.value).toBe('');
      expect(document.activeElement).toBe(input);
      // One at a time, in order.
      expect(onAdd.mock.calls.map((c) => c[0])).toEqual(['first']);
      for (let i = 0; i < 3; i++) {
        await act(async () => resolvers[i]());
      }
      expect(onAdd.mock.calls.map((c) => c[0])).toEqual(['first', 'second', 'third']);
    });

    it('when the server refuses a tag, its message shows and the text comes back to the empty box', async () => {
      const { input } = withNeighbours(vi.fn(async () => 'Server said no.'));
      await userEvent.click(input);
      await userEvent.keyboard('refused{Tab}');
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe('Server said no.');
      expect(input.value).toBe('refused');
    });

    it('on an invalid tag shows the message, keeps the text and the focus', async () => {
      const { onAdd, input } = withNeighbours();
      await userEvent.click(input);
      await userEvent.keyboard('to-do{Tab}');
      expect(onAdd).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent!.length).toBeGreaterThan(5);
      expect(input.value).toBe('to-do');
      expect(document.activeElement).toBe(input);
    });

    it('on an empty box moves the focus on as usual; Shift+Tab is never intercepted', async () => {
      const { onAdd, input } = withNeighbours();
      await userEvent.click(input);
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }));
      await userEvent.click(input);
      await userEvent.keyboard('half');
      await userEvent.tab({ shift: true });
      expect(document.activeElement).not.toBe(input);
      expect(onAdd).not.toHaveBeenCalled();
      expect(input.value).toBe('half');
    });
  });

  it('shows the note’s tags', () => {
    setup(['demo', 'fonts']);
    expect(screen.getByText('#demo')).toBeTruthy();
    expect(screen.getByText('#fonts')).toBeTruthy();
  });

  it('adds a valid tag, lowercased', async () => {
    const { onAdd, input } = setup();
    await userEvent.type(input, 'Styles{Enter}');
    expect(onAdd).toHaveBeenCalledWith('styles');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it.each(['to-do', 'demo1', 'two words', 'café', 'a'.repeat(31)])('rejects %j with a message and does not add it', async (bad) => {
    const { onAdd, input } = setup();
    await userEvent.type(input, `${bad}{Enter}`);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent!.length).toBeGreaterThan(5);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the message when the user types again', async () => {
    const { input } = setup();
    await userEvent.type(input, 'to-do{Enter}');
    expect(screen.queryByRole('alert')).not.toBeNull();
    await userEvent.type(input, 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a message from the server', async () => {
    const { input } = setup([], vi.fn(async () => 'Server said no.'));
    await userEvent.type(input, 'fine{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('Server said no.');
  });

  it('does not add a tag the note already has', async () => {
    const { onAdd, input } = setup(['demo']);
    await userEvent.type(input, 'DEMO{Enter}');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds what is in the field even if it arrived without a change event (autofill, input methods)', async () => {
    const { onAdd, input } = setup([]);
    (input as HTMLInputElement).value = 'alpha'; // React's onChange never sees this
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('alpha'));
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('adds several tags one after another', async () => {
    const added: string[] = [];
    const { input } = setup([], vi.fn(async (t: string) => (added.push(t), null)));
    for (const t of ['one', 'two', 'three']) await userEvent.type(input, `${t}{Enter}`);
    expect(added).toEqual(['one', 'two', 'three']);
  });

  it('removes a tag', async () => {
    const { onRemove } = setup(['demo']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag demo' }));
    expect(onRemove).toHaveBeenCalledWith('demo');
  });
});

describe('tag names open the home page filtered by that tag', () => {
  it('in the editor header', async () => {
    const onOpenTag = vi.fn();
    render(<TagInput tags={['demo', 'fonts']} onAdd={async () => null} onRemove={() => {}} onOpenTag={onOpenTag} />);
    await userEvent.click(screen.getByRole('button', { name: '#fonts' }));
    expect(onOpenTag).toHaveBeenCalledWith('fonts');
  });

  it('on a note card', async () => {
    history.replaceState(null, '', '/');
    const note = { id: 'n1', title: 'Card', preview: 'text', tags: ['demo', 'fonts'], createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', deletedAt: null, readOnly: false, inbox: false, botName: null, section: 'default' };
    render(<NoteCard note={note} now={new Date('2026-11-18T00:01:00Z')} />);
    const link = screen.getByRole('link', { name: '#fonts' });
    expect(link.getAttribute('href')).toBe('/?tag=fonts');
    await userEvent.click(link);
    expect(location.pathname + location.search).toBe('/?tag=fonts');
    // The rest of the card still opens the note.
    expect(screen.getByRole('link', { name: 'Card' }).getAttribute('href')).toBe('/n/n1');
    await userEvent.click(screen.getByRole('link', { name: 'Card' }));
    expect(location.pathname).toBe('/n/n1');
  });
});

describe('PhotoControls', () => {
  function setup(attrs: Record<string, unknown> = {}) {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/api/photos/abcdefghijklmnopqrstuv', ...attrs } }, { type: 'paragraph' }],
    });
    editor.commands.setNodeSelection(0);
    render(<PhotoControls editor={editor} />);
    const img = () => editor.view.dom.querySelector('.jot-photo img') as HTMLImageElement;
    return { editor, img, attrs: () => editor.getJSON().content![0].attrs! };
  }

  it('sets the width and shows it at once', async () => {
    const { attrs, img } = setup({ width: 300 });
    const box = screen.getByRole('textbox', { name: 'Photo width' }) as HTMLInputElement;
    expect(box.value).toBe('300');
    await userEvent.clear(box);
    await userEvent.type(box, '420{Enter}');
    expect(attrs().width).toBe(420);
    expect(img().style.width).toBe('420px');
    await userEvent.click(screen.getByRole('button', { name: 'Wider' }));
    expect(attrs().width).toBe(440);
    await userEvent.click(screen.getByRole('button', { name: 'Narrower' }));
    expect(attrs().width).toBe(420);
    await userEvent.click(screen.getByRole('button', { name: 'Original size' }));
    expect(attrs().width).toBeNull();
  });

  it('offers border sizes 0 to 10 px, defaulting to none', async () => {
    const { attrs, img } = setup();
    const select = screen.getByRole('combobox', { name: 'Border size' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(select.value).toBe('0');
    expect(attrs().borderWidth).toBe(0);
    await userEvent.selectOptions(select, '6');
    expect(attrs().borderWidth).toBe(6);
    expect(img().style.border).toMatch(/^6px solid/);
  });

  it('border colours are swatches only, with accessible names', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Border colour' });
    expect(group.textContent).toBe('');
  });

  it('offers exactly the 10 palette border colours', async () => {
    const { attrs, img } = setup({ borderWidth: 4 });
    const swatches = screen.getAllByRole('button', { name: /^Border colour / });
    expect(swatches.map((s) => s.getAttribute('aria-label')!.replace('Border colour ', ''))).toEqual([
      'Jet',
      'Crimson',
      'Tangerine',
      'Sunflower',
      'Lime',
      'Jade',
      'Cyan',
      'Electric',
      'Violet',
      'Magenta',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Border colour Lime' }));
    expect(attrs().borderColor).toBe('Lime');
    expect(img().style.border).toBe('4px solid rgb(139, 231, 35)'); // #8BE723
    expect(screen.getByRole('button', { name: 'Border colour Lime' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('choosing a colour on a borderless photo gives it a visible border', async () => {
    const { attrs } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Border colour Crimson' }));
    expect(attrs()).toMatchObject({ borderColor: 'Crimson', borderWidth: 2 });
  });

  it('draws a grab handle on each of the four corners', () => {
    const { editor } = setup({ width: 300 });
    const handles = [...editor.view.dom.querySelectorAll('.jot-photo .jot-photo-handle')] as HTMLElement[];
    expect(handles.map((h) => h.dataset.corner).sort()).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
    expect(editor.view.dom.querySelector('.jot-photo')!.classList.contains('is-selected')).toBe(true);
  });

  it('corner drags keep the aspect ratio, grow outwards from every corner, and respect the limits', () => {
    expect(CORNERS.length).toBe(4);
    // dragging outwards horizontally
    expect(cornerDragWidth('bottom-right', 200, 4 / 3, 50, 0)).toBe(250);
    expect(cornerDragWidth('top-right', 200, 4 / 3, 50, 0)).toBe(250);
    expect(cornerDragWidth('bottom-left', 200, 4 / 3, -50, 0)).toBe(250);
    expect(cornerDragWidth('top-left', 200, 4 / 3, -50, 0)).toBe(250);
    // inwards shrinks
    expect(cornerDragWidth('top-left', 200, 4 / 3, 50, 0)).toBe(150);
    // vertical drags scale by the aspect ratio
    expect(cornerDragWidth('bottom-right', 200, 4 / 3, 0, 30)).toBe(240);
    expect(cornerDragWidth('top-left', 200, 4 / 3, 0, -30)).toBe(240);
    // limits
    expect(cornerDragWidth('bottom-right', 200, 4 / 3, -1000, 0)).toBe(40);
    expect(cornerDragWidth('bottom-right', 200, 4 / 3, 9000, 0)).toBe(4000);
  });

  it('the width box follows a corner drag live', () => {
    setup({ width: 300 });
    act(() => {
      photoResizeEvents.dispatchEvent(new CustomEvent('resize', { detail: { width: 512 } }));
    });
    expect((screen.getByRole('textbox', { name: 'Photo width' }) as HTMLInputElement).value).toBe('512');
  });

  it('the photo node keeps width and border through save and load', () => {
    const { editor } = setup({ width: 250, borderWidth: 3, borderColor: 'Violet' });
    const json = editor.getJSON();
    const again = makeEditor(json);
    expect(again.getJSON().content![0].attrs).toMatchObject({ width: 250, borderWidth: 3, borderColor: 'Violet' });
    act(() => {});
  });
});
