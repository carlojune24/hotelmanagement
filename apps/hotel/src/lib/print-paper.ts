/** Bond-paper sheets a full-page print can fill, in mm (portrait). */
export const PAPER = {
	a4: { w: 210, h: 297, label: 'A4' },
	letter: { w: 215.9, h: 279.4, label: 'Letter (short)' },
	legal: { w: 215.9, h: 355.6, label: 'Legal (long)' }
} as const;

export type PaperKey = keyof typeof PAPER;

export const paperFrom = (v: string | null): PaperKey => (v && v in PAPER ? (v as PaperKey) : 'a4');
