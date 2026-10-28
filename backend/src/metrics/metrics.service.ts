import { Injectable } from "@nestjs/common";

type CounterName = "evaluations" | "datasetFetches" | "kills";

const COUNTERS: Record<CounterName, { metric: string; help: string }> = {
  evaluations: {
    metric: "flagship_evaluations_total",
    help: "Flag evaluations performed by the API (dashboard test targeting). SDKs evaluate locally and are not counted.",
  },
  datasetFetches: {
    metric: "flagship_dataset_fetches_total",
    help: "Flag set fetches served to SDK clients.",
  },
  kills: {
    metric: "flagship_kills_total",
    help: "Kill switch flips (flag turned off) recorded in the audit log.",
  },
};

/** In-process counters rendered in the Prometheus text format. Reset on restart. */
@Injectable()
export class MetricsService {
  private readonly values: Record<CounterName, number> = {
    evaluations: 0,
    datasetFetches: 0,
    kills: 0,
  };

  inc(name: CounterName) {
    this.values[name] += 1;
  }

  render(): string {
    const lines: string[] = [];
    for (const name of Object.keys(COUNTERS) as CounterName[]) {
      const { metric, help } = COUNTERS[name];
      lines.push(`# HELP ${metric} ${help}`, `# TYPE ${metric} counter`, `${metric} ${this.values[name]}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
