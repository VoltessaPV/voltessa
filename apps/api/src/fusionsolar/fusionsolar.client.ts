import { Injectable } from '@nestjs/common';

@Injectable()
export class FusionSolarClient {

    async login() {
        throw new Error('Not implemented');
    }

    async getExportMode() {
        throw new Error('Not implemented');
    }

    async stopExport() {
        throw new Error('Not implemented');
    }

    async resumeExport() {
        throw new Error('Not implemented');
    }

}