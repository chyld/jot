// Side-effect module imported at app startup (before lazy BoardEditor loads) so
// Excalidraw loads its self-hosted fonts from Jot's own origin instead of esm.sh.
if (typeof window !== 'undefined') {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

  // Excalidraw 0.18.1 unconditionally appends https://esm.sh/... as a fallback URL inside
  // every new FontFace(family, source, descriptors) call. Strip that external fallback so
  // browsers never probe esm.sh or emit CSP violations when running offline/self-hosted.
  const NativeFontFace = window.FontFace;
  if (typeof NativeFontFace === 'function' && !(NativeFontFace as { __jotWrapped?: boolean }).__jotWrapped) {
    class LocalExcalidrawFontFace extends NativeFontFace {
      static __jotWrapped = true;
      constructor(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
        if (typeof source === 'string' && source.includes('/excalidraw/fonts/') && source.includes('https://esm.sh/')) {
          const cleaned = source
            .split(',')
            .map((part) => part.trim())
            .filter((part) => !part.includes('https://esm.sh/'))
            .join(', ');
          super(family, cleaned || source, descriptors);
        } else {
          super(family, source, descriptors);
        }
      }
    }
    window.FontFace = LocalExcalidrawFontFace;
  }
}
