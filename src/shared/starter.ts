// The five starter fonts every user receives. They are the default fonts: they can
// never be archived (they are recognised by family name; a user has at most one font
// per family).
export const STARTER_FONT_FAMILIES = ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code'] as const;

export function isDefaultFont(family: string): boolean {
  return (STARTER_FONT_FAMILIES as readonly string[]).includes(family);
}
