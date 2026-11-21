// The left bar's section button (sections-spec.md §3, mockup B1): a square in the current
// section's accent colour with the first letter of its name. Its menu lists the sections
// (colour dot, name, a tick on the current one); choosing one makes it current and goes to
// its home page. "Manage sections" opens the Sections page.
import { Check } from 'lucide-react';
import { setCurrentSection, useSections } from '../currentSection';
import { navigate } from '../router';
import { THEMES } from '../theme';
import { Dropdown, MenuItem } from './Dropdown';

export const firstLetter = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

export function SectionDot(props: { colour: keyof typeof THEMES }) {
  return <span className="section-dot" aria-hidden="true" style={{ background: THEMES[props.colour]?.accent }} />;
}

export function SectionMenu() {
  const { sections, current } = useSections();
  return (
    <Dropdown
      label={`Section: ${current.name}`}
      className="rail-section"
      menuClassName="menu-sections"
      button={
        <span className="section-square" aria-hidden="true">
          {firstLetter(current.name)}
        </span>
      }
    >
      {(close) => (
        <>
          {sections.map((s) => (
            <MenuItem
              key={s.id}
              label={s.id === current.id ? `${s.name} (current section)` : s.name}
              onSelect={() => {
                close();
                setCurrentSection(s.id);
                navigate('/');
              }}
            >
              <SectionDot colour={s.colour} />
              <span className="grow">{s.name}</span>
              {s.id === current.id && <Check size={16} aria-hidden="true" />}
            </MenuItem>
          ))}
          <div className="menu-sep" />
          <MenuItem
            onSelect={() => {
              close();
              navigate('/sections');
            }}
          >
            Manage sections
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}
