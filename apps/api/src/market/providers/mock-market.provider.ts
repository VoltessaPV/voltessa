import { Injectable } from '@nestjs/common';
import { MarketProvider, MarketPrice } from './market-provider.interface';

@Injectable()
export class MockMarketProvider implements MarketProvider {
  // eslint-disable-next-line @typescript-eslint/require-await -- must stay async to satisfy the MarketProvider interface
  async getCurrentPrice(): Promise<MarketPrice> {
    return {
      market: 'IBEX',
      price: -12.45,
      currency: 'EUR/MWh',
      timestamp: new Date().toISOString(),
    };
  }
}
