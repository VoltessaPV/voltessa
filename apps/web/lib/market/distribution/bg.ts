/**
 * Licensed electricity distribution network operators (DSOs) in Bulgaria —
 * data only, no UI. Settings > Energy Market's DSO dropdown reads
 * `getBulgarianDistributionOperators()` instead of hardcoding options
 * inline, mirroring `lib/market/suppliers/bg.ts`'s supplier list so this
 * list can be extended or corrected without touching any component.
 *
 * Bulgaria has exactly three regional distribution networks, each a
 * regulated monopoly for its territory (unlike suppliers, which compete) —
 * there is no "Other"/"Unknown" entry, and none is expected.
 *
 * `officialBulgarianName` is each company's own registered Bulgarian legal
 * name (Cyrillic, with its legal-form suffix) and is what the UI displays.
 * `officialLatinName` is a plain transliteration, kept for the same reason
 * as the supplier list — not itself an official register field.
 */
export type DistributionNetworkOperator = {
  id: string;
  officialLatinName: string;
  officialBulgarianName: string;
  active: boolean;
};

const BULGARIAN_DISTRIBUTION_OPERATORS: readonly DistributionNetworkOperator[] = [
  {
    id: "elektrorazpredelenie-yug",
    officialLatinName: "Elektrorazpredelenie Yug EAD",
    officialBulgarianName: "Електроразпределение Юг ЕАД",
    active: true,
  },
  {
    id: "elektrorazpredelitelni-mrezhi-zapad",
    officialLatinName: "Elektrorazpredelitelni Mrezhi Zapad EAD",
    officialBulgarianName: "Електроразпределителни мрежи Запад ЕАД",
    active: true,
  },
  {
    id: "elektrorazpredelenie-sever",
    officialLatinName: "Elektrorazpredelenie Sever AD",
    officialBulgarianName: "Електроразпределение Север АД",
    active: true,
  },
];

/** Active operators sorted alphabetically by `officialBulgarianName` — the field the UI displays. */
export function getBulgarianDistributionOperators(): DistributionNetworkOperator[] {
  return BULGARIAN_DISTRIBUTION_OPERATORS.filter((operator) => operator.active).sort((a, b) =>
    a.officialBulgarianName.localeCompare(b.officialBulgarianName, "bg"),
  );
}
