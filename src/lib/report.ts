/**
 * "Souffrance en Rayon" — ICAW report, October 2026.
 * Retailer commitments as published in the report (public data at 1 October 2026).
 * Retailer names may only appear on the report page (campaign rule).
 */
export const report = {
  url: 'https://www.souffrance-en-rayon.com/',
  pdf: 'https://www.souffrance-en-rayon.com/s/Souffrance-en-Rayon-2026-wfxd.pdf',
  dataDate: new Date('2026-10-01T00:00:00+02:00'),
  published: new Date('2026-10-16T00:00:00+02:00'),
};

export type Status = 'engage' | 'partiel' | 'non';

export interface Retailer {
  name: string;
  /** market share (%) for the 8 main retailers; specialists have a segment instead */
  share?: number;
  approx?: boolean;
  segment?: { fr: string; en: string };
  ablation: boolean;
  stunning: boolean;
}

export const retailers: Retailer[] = [
  { name: 'Les Mousquetaires (Intermarché)', share: 17.8, ablation: true, stunning: true },
  { name: 'Coopérative U', share: 13.1, ablation: true, stunning: true },
  { name: 'Auchan', share: 8.2, ablation: true, stunning: true },
  { name: 'Aldi', share: 3, approx: true, ablation: true, stunning: true },
  { name: 'Carrefour', share: 21.6, ablation: true, stunning: false },
  { name: 'Lidl', share: 8.2, ablation: true, stunning: false },
  { name: 'Groupe Casino', share: 3, approx: true, ablation: true, stunning: false },
  { name: 'E.Leclerc', share: 24, ablation: false, stunning: false },
  { name: 'Biocoop', segment: { fr: 'Spécialiste bio', en: 'Organic specialist' }, ablation: false, stunning: false },
  { name: 'Grand Frais', segment: { fr: 'Spécialiste frais', en: 'Fresh food specialist' }, ablation: false, stunning: false },
  { name: 'Picard', segment: { fr: 'Spécialiste surgelés', en: 'Frozen food specialist' }, ablation: false, stunning: false },
];

export const statusOf = (r: Retailer): Status => (r.ablation && r.stunning ? 'engage' : r.ablation || r.stunning ? 'partiel' : 'non');

export const counts = {
  engage: retailers.filter((r) => statusOf(r) === 'engage').length,
  partiel: retailers.filter((r) => statusOf(r) === 'partiel').length,
  non: retailers.filter((r) => statusOf(r) === 'non').length,
  total: retailers.length,
};
