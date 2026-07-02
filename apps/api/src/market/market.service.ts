import { Injectable } from '@nestjs/common';
import { MockMarketProvider } from './providers/mock-market.provider';

@Injectable()
export class MarketService {
  constructor(
    private readonly provider: MockMarketProvider,
  ) {}

  async getCurrentPrice() {
    const price = await this.provider.getCurrentPrice();

    return {
      ...price,
      isNegative: price.price < 0,
    };
  }
}