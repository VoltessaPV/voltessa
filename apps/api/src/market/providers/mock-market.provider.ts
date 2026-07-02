import { Injectable } from '@nestjs/common';
import {
  MarketProvider,
  MarketPrice,
} from './market-provider.interface';

@Injectable()
export class MockMarketProvider implements MarketProvider {
  async getCurrentPrice(): Promise<MarketPrice> {
    return {
      market: 'IBEX',
      price: -12.45,
      currency: 'EUR/MWh',
      timestamp: new Date().toISOString(),
    };
  }
}