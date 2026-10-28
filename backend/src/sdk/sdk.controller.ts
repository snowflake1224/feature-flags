import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { SdkAuthService } from "../common/sdk-auth.service";
import { DatasetService } from "../dataset/dataset.service";
import { MetricsService } from "../metrics/metrics.service";

/**
 * SDK endpoint, authenticated by an environment SDK key (Bearer token).
 * Clients poll this every few seconds and evaluate the copy they fetched.
 */
@Controller("sdk")
export class SdkController {
  constructor(
    private sdkAuth: SdkAuthService,
    private dataset: DatasetService,
    private metrics: MetricsService,
  ) {}

  @Get("dataset")
  async getDataset(@Req() req: Request) {
    const { environmentId } = await this.sdkAuth.resolveFromRequest(req);
    this.metrics.inc("datasetFetches");
    return this.dataset.getDataset(environmentId);
  }
}
