// Small marks that show a section: the square in its accent colour with the first letter of
// its name (the left bar's section link and the Sections page cards, sections-spec.md §3–§4)
// and the colour dot (the note's section control, §6).
import { THEMES } from '../theme';

const firstLetter = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

export function SectionSquare(props: { name: string }) {
  return (
    <span className="section-square" aria-hidden="true">
      {firstLetter(props.name)}
    </span>
  );
}

export function SectionDot(props: { colour: keyof typeof THEMES }) {
  return <span className="section-dot" aria-hidden="true" style={{ background: THEMES[props.colour]?.accent }} />;
}
