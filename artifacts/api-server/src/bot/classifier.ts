import type { Direction } from './types.js';

const THRESHOLDS = {
  price: 1.5,    // % change
  oi: 3.0,       // % change
  funding: 0.02, // absolute pp change
};

function classifyByPercentChange(oldest: number, newest: number, thresholdPercent: number): Direction {
  if (oldest === 0) return 'STABLE';
  const pctChange = ((newest - oldest) / Math.abs(oldest)) * 100;
  if (pctChange >= thresholdPercent) return 'RISING';
  if (pctChange <= -thresholdPercent) return 'FALLING';
  return 'STABLE';
}

function classifyFundingChange(oldest: number, newest: number, thresholdAbsPp: number): Direction {
  const diff = newest - oldest;
  if (diff >= thresholdAbsPp) return 'RISING';
  if (diff <= -thresholdAbsPp) return 'FALLING';
  return 'STABLE';
}

export interface ClassifyResult {
  oi: Direction;
  price: Direction;
  funding: Direction;
  raw: {
    priceStart: number; priceEnd: number;
    oiStart: number;    oiEnd: number;
    fundingStart: number; fundingEnd: number;
  };
}

export function classify(params: {
  priceSeries: number[];
  oiSeries: number[];
  fundingSeries: number[];
}): ClassifyResult {
  const { priceSeries, oiSeries, fundingSeries } = params;
  const priceDir = classifyByPercentChange(priceSeries[0], priceSeries[priceSeries.length - 1], THRESHOLDS.price);
  const oiDir = classifyByPercentChange(oiSeries[0], oiSeries[oiSeries.length - 1], THRESHOLDS.oi);
  const fundingDir = classifyFundingChange(fundingSeries[0], fundingSeries[fundingSeries.length - 1], THRESHOLDS.funding);
  return {
    oi: oiDir, price: priceDir, funding: fundingDir,
    raw: {
      priceStart: priceSeries[0], priceEnd: priceSeries[priceSeries.length - 1],
      oiStart: oiSeries[0],       oiEnd: oiSeries[oiSeries.length - 1],
      fundingStart: fundingSeries[0], fundingEnd: fundingSeries[fundingSeries.length - 1],
    },
  };
}

export { classifyByPercentChange, classifyFundingChange, THRESHOLDS };
