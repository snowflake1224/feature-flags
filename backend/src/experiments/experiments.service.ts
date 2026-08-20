import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { twoProportionTest } from "./stats";

export interface CreateExperimentInput {
  key: string;
  name: string;
  flagKey: string;
  exposureEvent: string;
  goalEvent: string;
  metricKind?: "binary" | "numeric";
}

@Injectable()
export class ExperimentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(environmentId: string) {
    return this.prisma.experiment.findMany({ where: { environmentId }, orderBy: { createdAt: "desc" } });
  }

  async create(projectId: string, environmentId: string, input: CreateExperimentInput, actor: string) {
    const exp = await this.prisma.experiment.create({
      data: {
        projectId,
        environmentId,
        key: input.key,
        name: input.name,
        flagKey: input.flagKey,
        exposureEvent: input.exposureEvent,
        goalEvent: input.goalEvent,
        metricKind: input.metricKind ?? "binary",
      },
    });
    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: "experiment.created",
      entityType: "experiment",
      entityId: exp.id,
      entityKey: exp.key,
      after: { flagKey: exp.flagKey, goalEvent: exp.goalEvent },
    });
    return exp;
  }

  /**
   * Compute per-variation conversion metrics for an experiment.
   *
   * Exposure and goal events are grouped by the variation index resolved at
   * ingest time. We then run a two-proportion z-test of each variation against
   * the control (variation 0) to surface statistical significance.
   */
  async results(environmentId: string, key: string) {
    const exp = await this.prisma.experiment.findUnique({
      where: { environmentId_key: { environmentId, key } },
    });
    if (!exp) throw new NotFoundException("experiment not found");

    const flag = await this.prisma.flag.findFirst({
      where: { projectId: exp.projectId, key: exp.flagKey },
    });
    const variationValues = (flag?.variations as unknown[]) ?? [];

    const events = await this.prisma.event.findMany({
      where: {
        environmentId,
        flagKey: exp.flagKey,
        eventKey: { in: [exp.exposureEvent, exp.goalEvent] },
      },
      select: { eventKey: true, contextKey: true, variationIndex: true, value: true },
    });

    // variationIndex -> { exposed:Set, converted:Set, valueSum }
    const byVar = new Map<
      number,
      { exposed: Set<string>; converted: Set<string>; valueSum: number }
    >();
    const bucket = (v: number) => {
      if (!byVar.has(v)) byVar.set(v, { exposed: new Set(), converted: new Set(), valueSum: 0 });
      return byVar.get(v)!;
    };

    for (const e of events) {
      if (e.variationIndex === null || e.variationIndex === undefined) continue;
      const b = bucket(e.variationIndex);
      if (e.eventKey === exp.exposureEvent) b.exposed.add(e.contextKey);
      if (e.eventKey === exp.goalEvent) {
        b.converted.add(e.contextKey);
        b.valueSum += e.value ?? 0;
      }
    }

    const controlIdx = 0;
    const control = byVar.get(controlIdx);
    const controlExposed = control?.exposed.size ?? 0;
    const controlConverted = control?.converted.size ?? 0;

    const variations = Array.from(byVar.keys())
      .sort((a, b) => a - b)
      .map((idx) => {
        const b = byVar.get(idx)!;
        const exposures = b.exposed.size;
        const conversions = b.converted.size;
        const conversionRate = exposures ? conversions / exposures : 0;
        const test =
          idx === controlIdx
            ? { z: 0, pValue: 1, relativeUplift: 0, significant: false }
            : twoProportionTest(controlConverted, controlExposed, conversions, exposures);
        return {
          variationIndex: idx,
          value: variationValues[idx] ?? null,
          isControl: idx === controlIdx,
          exposures,
          conversions,
          conversionRate,
          avgValue: conversions ? b.valueSum / conversions : 0,
          totalValue: b.valueSum,
          ...test,
        };
      });

    return {
      experiment: exp,
      totalExposures: variations.reduce((a, v) => a + v.exposures, 0),
      variations,
    };
  }
}
