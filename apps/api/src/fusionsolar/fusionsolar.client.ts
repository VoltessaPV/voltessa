import { Injectable } from '@nestjs/common';

@Injectable()
export class FusionSolarClient {
  // eslint-disable-next-line @typescript-eslint/require-await -- stub kept async to match the eventual FusionSolarClient contract
  async login() {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- stub kept async to match the eventual FusionSolarClient contract
  async getExportMode() {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- stub kept async to match the eventual FusionSolarClient contract
  async stopExport() {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- stub kept async to match the eventual FusionSolarClient contract
  async resumeExport() {
    throw new Error('Not implemented');
  }
}
