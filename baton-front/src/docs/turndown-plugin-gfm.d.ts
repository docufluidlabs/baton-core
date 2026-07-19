// turndown-plugin-gfm ships no types; we only use its `gfm` plugin (tables,
// strikethrough) in docToMarkdown.ts.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
