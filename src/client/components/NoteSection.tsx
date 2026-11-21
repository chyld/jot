// The note's section in the editor header (sections-spec.md §6): its colour dot and name.
// Clicking it opens the user's sections; choosing one moves the note there. A read-only or
// trashed note shows its section but cannot be moved.
import { Check } from 'lucide-react';
import { useSections } from '../currentSection';
import { Dropdown, MenuItem, ToolbarDisabled } from './Dropdown';
import { SectionDot } from './SectionMenu';

export function NoteSection(props: { section: string; disabled: boolean; onMove: (section: string) => void }) {
  const { sections } = useSections();
  const mine = sections.find((s) => s.id === props.section) ?? { id: props.section, name: props.section, colour: 'olive' as const };
  return (
    <ToolbarDisabled.Provider value={props.disabled}>
      <Dropdown
        label={`Section: ${mine.name}`}
        className="note-section"
        button={
          <>
            <SectionDot colour={mine.colour} />
            <span>{mine.name}</span>
          </>
        }
      >
        {(close) =>
          sections.map((s) => (
            <MenuItem
              key={s.id}
              label={s.id === mine.id ? `${s.name} (this note's section)` : `Move to ${s.name}`}
              onSelect={() => {
                close();
                if (s.id !== mine.id) props.onMove(s.id);
              }}
            >
              <SectionDot colour={s.colour} />
              <span className="grow">{s.name}</span>
              {s.id === mine.id && <Check size={16} aria-hidden="true" />}
            </MenuItem>
          ))
        }
      </Dropdown>
    </ToolbarDisabled.Provider>
  );
}
