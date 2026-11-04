import type { Color, SceneKey } from '../world/types';

export interface StreetProp {
  kind: 'kiosk' | 'bench' | 'planter' | 'bikes';
  x: number;
}
export interface LifeScene {
  shop: string;
  shopName: string;
  shopColor: Color;
  ferryName: string;
  ferryColor: Color;
  pier: number;
  work: number;
  props: readonly StreetProp[];
}

/** Facility layout and local character; signal-driven residents share these destinations. */
export const LIFE_SCENES: Record<SceneKey, LifeScene> = {
  bund: {
    shop: 'CAFE',
    shopName: '江边咖啡摊',
    shopColor: [0.77, 0.57, 0.36],
    ferryName: '黄浦江轮渡',
    ferryColor: [0.62, 0.77, 0.81],
    pier: 0.82,
    work: 0.58,
    props: [
      { kind: 'kiosk', x: 0.18 },
      { kind: 'bench', x: 0.43 },
      { kind: 'bikes', x: 0.94 },
    ],
  },
  nyc: {
    shop: 'NEWS',
    shopName: '滨水报刊亭',
    shopColor: [0.43, 0.65, 0.6],
    ferryName: '东河通勤渡轮',
    ferryColor: [0.9, 0.66, 0.34],
    pier: 0.77,
    work: 0.62,
    props: [
      { kind: 'bikes', x: 0.96 },
      { kind: 'kiosk', x: 0.3 },
      { kind: 'bench', x: 0.51 },
    ],
  },
  hk: {
    shop: 'TEA',
    shopName: '海滨茶档',
    shopColor: [0.68, 0.43, 0.35],
    ferryName: '维港渡轮',
    ferryColor: [0.42, 0.73, 0.58],
    pier: 0.72,
    work: 0.57,
    props: [
      { kind: 'kiosk', x: 0.24 },
      { kind: 'bench', x: 0.46 },
      { kind: 'bikes', x: 0.96 },
    ],
  },
};
