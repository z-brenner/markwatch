// Prepares merged draft text for leaving the app. Internal drafting notes are
// for the user only and are removed from every export path; placeholder legal
// language is counted so the UI can warn before anything goes out.

// A note ends at a "]" that closes its line, so a "]" typed into a merge field
// inside the note cannot cut the strip short.
const INTERNAL_NOTE = /\[INTERNAL NOTE — DELETE BEFORE SENDING[\s\S]*?\](?=[ \t]*(?:\n|$))/g;
const PLACEHOLDER = /\[PLACEHOLDER LEGAL LANGUAGE[^\]]*\]/g;

export interface ExportText {
  text: string;
  removedNotes: number;
  placeholders: number;
}

export function prepareExport(text: string): ExportText {
  let removedNotes = 0;
  const stripped = text.replace(INTERNAL_NOTE, () => {
    removedNotes++;
    return '';
  });
  const cleaned = stripped
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: `${cleaned}\n`, removedNotes, placeholders: (cleaned.match(PLACEHOLDER) ?? []).length };
}
