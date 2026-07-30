/**
 * Licensed electricity traders on the Bulgarian free (liberalized) market —
 * data only, no UI. Settings > Energy Market's supplier dropdown reads
 * `getBulgarianElectricitySuppliers()` instead of hardcoding options
 * inline, so this list can be extended, corrected, or localized without
 * touching any component.
 *
 * Names are sourced from the Energy and Water Regulatory Commission's
 * (КЕВР/EWRC) own public electricity-trading license registry
 * (portal.dker.bg/registri/litsenzii) — every entry below is a real
 * licensed company, not a fabricated one. Entities from that registry that
 * are clearly not retail-facing free-market suppliers (mines, power
 * plants, the nuclear plant operator, pure wholesale/financial commodities
 * arms of foreign banks) are intentionally excluded, since this list's
 * purpose is "which supplier can an end customer choose", not "every
 * holder of an electricity-trading license". Where the registry recorded a
 * company under an old name superseded by a later rename (e.g. ЧЕЗ Трейд
 * България → Електрохолд Трейд), only the current name is kept.
 *
 * `officialBulgarianName` is each company's own registered Bulgarian legal
 * name (Cyrillic, with its legal-form suffix). `officialLatinName` is a
 * plain transliteration/known international branding — not itself an
 * official register field, since the Bulgarian Commercial Register doesn't
 * maintain a separate Latin-script name for most of these companies.
 *
 * Data-quality pass (2026-07): cross-checked against ESO's (Elektroenergien
 * Sistemen Operator, the Bulgarian TSO) public register of standard
 * balancing-group coordinators and the Ministry of Energy's own published
 * list of electricity traders (Art. 36e Energy Act obligated parties) —
 * both independent of, and corroborating, the КЕВР license registry above.
 * "КЕР Токи Пауър" ЕАД was found missing: it holds license № Л-525 (issued
 * 25.09.2020) and is confirmed Active in ESO's coordinator register (EIC
 * 32X001100101677Y), but the company was originally registered under the
 * name "Токи Пауър" and only renamed to "КЕР Токи Пауър" on 28.04.2022 —
 * whichever registry snapshot this list was originally compiled from was
 * evidently taken either before that rename or simply missed this entity,
 * and was never revisited since. Energo-Pro Energy Services' legal form is
 * corrected from ЕООД to ЕАД for the same reason: ESO's register shows the
 * old ЕООД registration (EIC 32X0011001003109) as Withdrawn and a separate
 * ЕАД registration (EIC 32X001100100373M) as the current Active one — a
 * legal-form conversion, not a rename to a different company.
 *
 * A handful of other existing entries (e.g. Овергаз Инк., Пи Си Си
 * Енергия, Е.ОН Сейлс енд Трейдинг България, Енерджи Трейдинг, АЛБУС-РБ)
 * could not be found in either of the two additional sources checked here,
 * which is a signal worth investigating but not, on its own, proof of an
 * obsolete license — КЕВР's own license portal and its supplier-switching
 * platform (platforma.dker.bg/traders) are both JS-rendered/TLS-gated in a
 * way that couldn't be reliably fetched for this pass, and a trader can
 * validly hold a license without being its own balancing-group coordinator
 * or appearing on the Art. 36e list. These were deliberately left
 * unchanged rather than removed on incomplete evidence - flagged for a
 * follow-up pass with direct access to the КЕВР portal.
 */
export type ElectricitySupplier = {
  id: string;
  officialLatinName: string;
  officialBulgarianName: string;
  /** True only for the single "Supplier of Last Resort" entry — see `getBulgarianElectricitySuppliers`'s doc comment. */
  special?: boolean;
};

const BULGARIAN_ELECTRICITY_SUPPLIERS: readonly ElectricitySupplier[] = [
  { id: "elektrohold-trade", officialLatinName: "Elektrohold Trade EAD", officialBulgarianName: "Електрохолд Трейд ЕАД" },
  { id: "albus-rb", officialLatinName: "ALBUS-RB EOOD", officialBulgarianName: "АЛБУС-РБ ЕООД" },
  { id: "overgas-inc", officialLatinName: "Overgas Inc AD", officialBulgarianName: "Овергаз Инк. АД" },
  { id: "energy-market", officialLatinName: "Energy Market AD", officialBulgarianName: "Енерджи Маркет АД" },
  { id: "energy-trading", officialLatinName: "Energy Trading AD", officialBulgarianName: "Енерджи Трейдинг АД" },
  { id: "pcc-energy", officialLatinName: "PCC Energy EOOD", officialBulgarianName: "Пи Си Си Енергия ЕООД" },
  { id: "energo-pro-energy-services", officialLatinName: "Energo-Pro Energy Services EAD", officialBulgarianName: "Енерго-Про Енергийни Услуги ЕАД" },
  { id: "eon-sales-and-trading-bulgaria", officialLatinName: "E.ON Sales and Trading Bulgaria EOOD", officialBulgarianName: "Е.ОН Сейлс енд Трейдинг България ЕООД" },
  { id: "enemona-utilities", officialLatinName: "Enemona Utilities AD", officialBulgarianName: "Енемона Ютилитис АД" },
  { id: "elfor-bulgaria", officialLatinName: "Elfor Bulgaria EAD", officialBulgarianName: "Елфор България ЕАД" },
  { id: "trans-euroenergy", officialLatinName: "Trans Euroenergy AD", officialBulgarianName: "Транс Евроенергия АД" },
  { id: "balkan-utilities", officialLatinName: "Balkan Utilities AD", officialBulgarianName: "Болкан Ютилитис АД" },
  { id: "statkraft-south-east-europe", officialLatinName: "Statkraft South East Europe EOOD", officialBulgarianName: "Щаткрафт Саут Ийст Юръп ЕООД" },
  { id: "vivid-power", officialLatinName: "Vivid Power AD", officialBulgarianName: "Вивид Пауър АД" },
  { id: "arkadia-service", officialLatinName: "Arkadia Service AD", officialBulgarianName: "Аркадия сървис АД" },
  { id: "energy-financial-group", officialLatinName: "Energy Financial Group AD", officialBulgarianName: "Енергийна финансова група АД" },
  { id: "oet-united-energy-traders", officialLatinName: "OET United Energy Traders OOD", officialBulgarianName: "ОЕТ-Обединени енергийни търговци ООД" },
  { id: "cez-elektro-bulgaria", officialLatinName: "CEZ Elektro Bulgaria AD", officialBulgarianName: "ЧЕЗ Електро България АД" },
  { id: "national-electric-company", officialLatinName: "National Electric Company EAD", officialBulgarianName: "Национална електрическа компания ЕАД" },
  { id: "business-energy", officialLatinName: "Business Energy AD", officialBulgarianName: "Бизнес Енерджи АД" },
  { id: "ker-toki-power", officialLatinName: "KER Toki Power EAD", officialBulgarianName: "КЕР Токи Пауър ЕАД" },
  { id: "kimpex-energy", officialLatinName: "Kimpex Energy AD", officialBulgarianName: "Кимпекс Енерджи АД" },
  { id: "elcontrol", officialLatinName: "Elcontrol OOD", officialBulgarianName: "Елконтрол ООД" },
  { id: "energy-eco-trade", officialLatinName: "Energy Eco Trade AD", officialBulgarianName: "Енерджи Еко Трейд АД" },
  { id: "energetika-ld", officialLatinName: "Energetika-LD OOD", officialBulgarianName: "Енергетика-ЛД ООД" },
  { id: "bulenergy", officialLatinName: "Bulenergy EAD", officialBulgarianName: "Буленерджи ЕАД" },
  { id: "eco-elda-bulgaria", officialLatinName: "Eco-Elda Bulgaria EAD", officialBulgarianName: "Еко-Елда България ЕАД" },
  { id: "mega-el", officialLatinName: "Mega El EOOD", officialBulgarianName: "Мега Ел ЕООД" },
  { id: "power-logistics", officialLatinName: "Power Logistics EAD", officialBulgarianName: "Пауър Лоджистикс ЕАД" },
  { id: "alpiq-energy-bulgaria", officialLatinName: "Alpiq Energy Bulgaria EOOD", officialBulgarianName: "Алпик Енергия България ЕООД" },
  { id: "energy-supply", officialLatinName: "Energy Supply EOOD", officialBulgarianName: "Енерджи съплай ЕООД" },
  { id: "elba-energy", officialLatinName: "Elba Energy AD", officialBulgarianName: "Елба Енерджи АД" },
  { id: "hse-bulgaria", officialLatinName: "HSE Bulgaria EOOD", officialBulgarianName: "ХСЕ България ЕООД" },
  { id: "smk-energy", officialLatinName: "SMK Energy AD", officialBulgarianName: "Ес Ем Кей Енерджи АД" },
  { id: "verbund-austrian-power-trading", officialLatinName: "Verbund - Austrian Power Trading AD", officialBulgarianName: "Фербунд-Оустриан Пауър Трейдинг АД" },
  { id: "elmib-bulgaria", officialLatinName: "Elmib Bulgaria AD", officialBulgarianName: "Елмиб България АД" },
  { id: "evn-trading-south-east-europe", officialLatinName: "EVN Trading South East Europe EAD", officialBulgarianName: "ЕВН Трейдинг Саут Ийст Юръп ЕАД" },
  { id: "emu", officialLatinName: "EMU AD", officialBulgarianName: "ЕМУ АД" },
  { id: "energo-trade", officialLatinName: "Energo Trade OOD", officialBulgarianName: "Енерго Трейд ООД" },
  { id: "enemona", officialLatinName: "Enemona AD", officialBulgarianName: "Енемона АД" },
  { id: "gp-energy", officialLatinName: "GP Energy EOOD", officialBulgarianName: "Джи Пи Енерджи ЕООД" },
  { id: "veolia-energy-bulgaria", officialLatinName: "Veolia Energy Bulgaria EAD", officialBulgarianName: "Веолия Енерджи България ЕАД" },
  { id: "enel-global-trading", officialLatinName: "Enel Global Trading S.p.A.", officialBulgarianName: "Енел Глобал Трейдинг С.П.А." },
  { id: "energoinvestment", officialLatinName: "Energoinvestment AD", officialBulgarianName: "Енергоинвестмънт АД" },
  { id: "energy-mt", officialLatinName: "Energy MT EAD", officialBulgarianName: "Енерджи МТ ЕАД" },
  { id: "ivas-2008", officialLatinName: "IVAS 2008 OOD", officialBulgarianName: "ИВАС 2008 ООД" },
  { id: "tinmar-ind", officialLatinName: "Tinmar-Ind SA", officialBulgarianName: "Тинмар-Инд СА" },
  { id: "repower-trading-czech-republic", officialLatinName: "RePower Trading Czech Republic s.r.o.", officialBulgarianName: "Репауър Трейдинг Чешка Република СРО" },
  { id: "energo-pro-bulgaria", officialLatinName: "Energo-Pro Bulgaria EAD", officialBulgarianName: "Енерго-Про България ЕАД" },
  { id: "eolpower", officialLatinName: "Eolpower OOD", officialBulgarianName: "Еолпауър ООД" },

  // Always last, regardless of alphabetical order — see
  // `getBulgarianElectricitySuppliers`'s doc comment.
  {
    id: "supplier-of-last-resort",
    officialLatinName: "Supplier of Last Resort",
    officialBulgarianName: "Доставчик от последна инстанция",
    special: true,
  },
];

/**
 * Regular suppliers sorted alphabetically by `officialBulgarianName` — the
 * field the UI displays — with the one `special: true` entry ("Supplier of
 * Last Resort" — the statutory fallback supplier every free-market customer
 * is entitled to if they have no chosen supplier) always appended last,
 * never mixed into the alphabetical order. The dropdown that renders this
 * is expected to draw a separator before whichever entry has
 * `special: true` rather than hardcoding that it's the last item.
 */
export function getBulgarianElectricitySuppliers(): ElectricitySupplier[] {
  const regular = BULGARIAN_ELECTRICITY_SUPPLIERS.filter((supplier) => !supplier.special).sort(
    (a, b) => a.officialBulgarianName.localeCompare(b.officialBulgarianName, "bg"),
  );
  const special = BULGARIAN_ELECTRICITY_SUPPLIERS.filter((supplier) => supplier.special);

  return [...regular, ...special];
}
