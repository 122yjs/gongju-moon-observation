import { KOREAN_REGION_CENTERS, KoreanRegionCenter } from "./korean-region-centers";

const MAX_RESULTS = 8;

const SIDO_ALIASES: Record<string, string[]> = {
  서울특별시: ["서울"],
  부산광역시: ["부산"],
  대구광역시: ["대구"],
  인천광역시: ["인천"],
  광주광역시: ["광주"],
  대전광역시: ["대전"],
  울산광역시: ["울산"],
  세종특별자치시: ["세종"],
  경기도: ["경기"],
  강원도: ["강원"],
  충청북도: ["충북"],
  충청남도: ["충남"],
  전라북도: ["전북"],
  전라남도: ["전남"],
  경상북도: ["경북"],
  경상남도: ["경남"],
  제주특별자치도: ["제주"],
};

function compact(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase("ko-KR");
}

function regionLabel(region: KoreanRegionCenter) {
  return region.level === "sido" ? region.name : `${region.sido} ${region.name}`;
}

function regionTokens(region: KoreanRegionCenter) {
  const aliases = SIDO_ALIASES[region.sido] || [];
  const values = [
    region.name,
    region.shortName,
    regionLabel(region),
    `${region.sido}${region.name}`,
    `${region.sido}${region.shortName}`,
    ...aliases.flatMap((alias) => [alias, `${alias}${region.name}`, `${alias}${region.shortName}`]),
  ];
  return Array.from(new Set(values.map(compact).filter(Boolean)));
}

function scoreRegion(region: KoreanRegionCenter, query: string) {
  const tokens = regionTokens(region);
  if (tokens.includes(query)) return region.level === "sigungu" ? 100 : 95;
  if (tokens.some((token) => token.startsWith(query))) return region.level === "sigungu" ? 80 : 75;
  if (tokens.some((token) => token.includes(query))) return region.level === "sigungu" ? 60 : 55;
  return 0;
}

export function searchKoreanRegions(query: string) {
  const normalized = compact(query);
  if (normalized.length < 2) return [];
  return KOREAN_REGION_CENTERS
    .map((region) => ({ region, score: scoreRegion(region, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.region.code.localeCompare(right.region.code))
    .slice(0, MAX_RESULTS)
    .map(({ region }) => ({
      code: region.code,
      level: region.level,
      label: regionLabel(region),
      shortLabel: region.shortName,
      lat: region.lat,
      lon: region.lon,
      source: "KOSTAT 2013 행정구역 경계 중심 좌표",
    }));
}
