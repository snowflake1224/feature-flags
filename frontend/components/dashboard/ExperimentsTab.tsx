"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export default function ExperimentsTab({ projectId, envId }: { projectId: string; envId: string }) {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  const load = useCallback(() => {
    if (!envId) return;
    api.listExperiments(projectId, envId).then((xs) => {
      setExperiments(xs);
      if (xs[0]) setSelected(xs[0].key);
    });
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) api.experimentResults(projectId, envId, selected).then(setResults);
  }, [projectId, envId, selected]);

  const maxRate = results ? Math.max(...results.variations.map((v: any) => v.conversionRate), 0.0001) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {experiments.map((x) => (
          <button
            key={x.id}
            onClick={() => setSelected(x.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              selected === x.key ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            {x.name}
          </button>
        ))}
        {experiments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No experiments in this environment. Create one via the API, or run the seed script for a demo.
          </p>
        )}
      </div>

      {results && (
        <>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{results.experiment.name}</div>
                <div className="text-xs text-muted-foreground">
                  flag <code>{results.experiment.flagKey}</code> · goal{" "}
                  <code>{results.experiment.goalEvent}</code>
                </div>
              </div>
              <Badge color="blue">{results.totalExposures.toLocaleString()} exposures</Badge>
            </div>
          </Card>

          <div className="grid gap-3">
            {results.variations.map((v: any) => (
              <Card key={v.variationIndex}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Variation {v.variationIndex}</span>
                    <code className="text-xs">{JSON.stringify(v.value)}</code>
                    {v.isControl && <Badge>control</Badge>}
                    {!v.isControl && v.significant && (
                      <Badge color={v.relativeUplift >= 0 ? "green" : "red"}>
                        {v.relativeUplift >= 0 ? "▲" : "▼"} significant
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-semibold">{pct(v.conversionRate)}</div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${v.isControl ? "bg-gray-400" : "bg-primary"}`}
                    style={{ width: `${(v.conversionRate / maxRate) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex gap-6 text-xs text-muted-foreground">
                  <span>{v.conversions.toLocaleString()} / {v.exposures.toLocaleString()} converted</span>
                  {!v.isControl && (
                    <>
                      <span>
                        uplift{" "}
                        <span className={v.relativeUplift >= 0 ? "text-green-600" : "text-red-600"}>
                          {(v.relativeUplift * 100).toFixed(1)}%
                        </span>
                      </span>
                      <span>p = {v.pValue.toFixed(4)}</span>
                    </>
                  )}
                  {v.totalValue > 0 && <span>revenue ${v.totalValue.toLocaleString()}</span>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
